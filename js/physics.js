/* GökSim — uçuş dinamiği
 * Basitleştirilmiş 6 serbestlik dereceli model:
 *  - kuvvetler fiziksel (kaldırma, sürükleme, itki, yerçekimi, iniş takımı yayları)
 *  - aerodinamik momentler "açısal ivme yetkisi" olarak (dinamik basınçla ölçeklenir)
 *  - iniş takımı ve gövde temasları tork üretir (eylemsizlik matrisi köşegen)
 * Konum: enlem/boylam (radyan) + elipsoit yüksekliği (m). Hız: yerel ENU (m/s).
 */
(function (G) {
  'use strict';
  const GS = (G.GS = G.GS || {});
  const { V, Q, clamp, approach, smoothstep, atmosphere, noise1 } = GS;
  const g0 = 9.80665;
  const WGS_A = 6378137.0;
  const WGS_E2 = 0.00669437999014;

  function zAtPitch(p, th) {
    return p[1] * Math.sin(th) + p[2] * Math.cos(th);
  }

  function computeGroundPitch(def) {
    const pts = def.gear.points.filter((g) => !g.aux).map((g) => ({ pos: [g.pos[0], g.pos[1], g.pos[2] + (g.staticComp || 0)] }));
    const front = pts.filter((g) => g.pos[1] > 0);
    const rear = pts.filter((g) => g.pos[1] <= 0);
    if (!front.length || !rear.length) return 0;
    const f = (th) => Math.min(...front.map((g) => zAtPitch(g.pos, th))) - Math.min(...rear.map((g) => zAtPitch(g.pos, th)));
    let lo = -0.3, hi = 0.4;
    let flo = f(lo);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function prepareAircraft(def) {
    if (def._prepared) return def;
    const m = def.mass;
    for (const gp of def.gear.points) {
      if (gp.k == null) {
        const load = gp.share * m * g0;
        gp.k = (load / def.gear.compress) * (gp.kMul || 1);
        gp.c = 2 * (def.gear.zeta || 0.55) * Math.sqrt(gp.k * gp.share * m);
      } else if (gp.c == null) {
        gp.c = 2 * 0.5 * Math.sqrt(gp.k * 0.03 * m);
      }
      if (gp.travel == null) gp.travel = def.gear.compress * 3;
      if (gp.latMu == null) gp.latMu = 0.8;
    }
    for (const gp of def.gear.points) gp.staticComp = gp.aux ? 0 : (gp.share * m * g0) / gp.k;
    def.groundPitch = computeGroundPitch(def);
    // ağırlık merkezinin yerdeki yüksekliği (statik, yaylar sıkışmış)
    const q = Q.fromHPR(0, def.groundPitch, 0);
    let minZ = Infinity;
    for (const gp of def.gear.points) {
      if (gp.aux) continue;
      minZ = Math.min(minZ, Q.rotate(q, [gp.pos[0], gp.pos[1], gp.pos[2] + gp.staticComp])[2]);
    }
    def.cgHeight = -minZ;
    const c = def.ctrl;
    def.alphaStall = (def.CLmax - def.CL0) / def.CLa;
    def.dAlphaMax = c.Pa / c.Ka;
    def._prepared = true;
    return def;
  }

  // Kaldırma eğrisi (stall dahil)
  function liftCoef(a, CL0, CLa, CLmax, CLmin) {
    const aS = (CLmax - CL0) / CLa;
    const aN = (CLmin - CL0) / CLa;
    const flat = 1.05 * Math.sin(2 * a);
    if (a <= aS && a >= aN) return { CL: CL0 + CLa * a, stall: 0 };
    if (a > aS) {
      const post = CLmax - 5.5 * (a - aS);
      return { CL: Math.max(post, flat), stall: smoothstep(aS, aS + 0.08, a) };
    }
    const post = CLmin + 5.5 * (a - aN);
    return { CL: Math.min(post, flat), stall: smoothstep(-aN, -aN + 0.08, -a) };
  }

  function waveDrag(M, mcrit, peak) {
    if (M <= mcrit) return 0;
    if (M < 1.05) {
      const t = (M - mcrit) / (1.05 - mcrit);
      return peak * t * t;
    }
    return peak * Math.sqrt(1.05 / M);
  }

  class FlightModel {
    constructor(def, env) {
      this.env = env || { wind: [0, 0, 0], turbulence: 0 };
      this.realism = { on: false };
      this.t = 0;
      this.events = [];
      this.setAircraft(def);
    }

    setAircraft(def) {
      this.def = prepareAircraft(def);
      this.gearComp = def.gear.points.map(() => 0);
      this.gearSteer = 0;
    }

    reset(o) {
      const d = this.def;
      this.lat = o.lat;
      this.lon = o.lon;
      this.ground = o.ground != null ? o.ground : 0;
      this.crashed = false;
      this.crashReason = '';
      this.events = [];
      this.w = [0, 0, 0];
      this.elev = 0; this.ail = 0; this.rud = 0; this.trim = o.trim || 0;
      this.flaps = o.flaps || 0;
      this.spoiler = 0;
      this.engineOn = d.engine.type !== 'winch';
      if (o.engineOff && d.engine.type !== 'winch') this.engineOn = false;
      this.engState = this.engineOn ? 'on' : 'off';
      this.startT = 0;
      this.fuel = d.fuel ? d.fuel.cap * d.fuel.start : 0;
      this.fuelStart = this.fuel;
      this.mass = d.mass;
      this.flapsJammed = false;
      this.gearJammed = false;
      this.overG = false;
      this.overspeed = false;
      this.ultT = 0; this.vneT = 0; this.flapOverT = 0; this.gearOverT = 0;
      this.warn = {};
      this.winchTime = 0;
      this.winchDone = false;
      this.airTime = 0;
      this.wheelsDown = 0;
      this.maxComp = 0;
      this.scraping = false;
      this.alpha = 0; this.beta = 0; this.mach = 0; this.stallAmt = 0; this.nz = 1;
      this.thrust = 0; this.afterburner = false;
      if (o.onGround) {
        const pitch = d.groundPitch;
        this.q = Q.fromHPR(o.heading, pitch, 0);
        this.alt = this.ground + d.cgHeight;
        this.vel = [0, 0, 0];
        this.gearPos = 1;
        this.n = this.engineOn ? d.engine.idle : 0;
        this.wasOnGround = true;
        this.airTime = 0;
      } else {
        this.q = Q.fromHPR(o.heading, o.pitch || 0, 0);
        this.alt = o.alt;
        const spd = o.speed || 0;
        const f = Q.rotate(this.q, [0, 1, 0]);
        this.vel = V.scale(f, spd);
        this.gearPos = d.gear.retractable ? (o.gearDown ? 1 : 0) : 1;
        this.n = o.throttle != null ? o.throttle : 0.6;
        this.wasOnGround = false;
        this.airTime = 10;
        if (d.engine.type === 'winch') this.winchDone = true;
      }
      const atm = atmosphere(this.alt);
      this.rho = atm.rho;
      this.tas = V.len(this.vel);
      this.qf = (0.5 * atm.rho * this.tas * this.tas) / (0.5 * 1.225 * d.ctrl.vref * d.ctrl.vref);
      this.updateDerived();
    }

    setRealism(on) {
      this.realism = { on: !!on };
      if (!on) {
        this.mass = this.def.mass;
        this.flapsJammed = false;
        this.gearJammed = false;
        this.overG = false;
        this.overspeed = false;
        if (this.engState === 'starting') { this.engState = 'on'; this.engineOn = true; }
      }
    }

    // gerçekçi mod: yakıt, yapısal sınırlar, hasar
    realChecks(h, Va, atm, T, wheels, scraping) {
      const d = this.def, eng = d.engine;
      if (d.fuel && this.engineOn) {
        let burn;
        if (eng.type === 'prop') {
          const pw = clamp((this.n - eng.idle) / (1 - eng.idle), 0, 1);
          burn = d.fuel.burn * (0.15 + 0.85 * pw);
        } else burn = (this.afterburner ? d.fuel.abTsfc : d.fuel.tsfc) * T + d.fuel.idleBurn;
        this.fuel = Math.max(0, this.fuel - burn * h);
        this.mass = d.mass - (this.fuelStart - this.fuel);
        if (!this.warn.fuelLow && this.fuel < 0.1 * d.fuel.cap) {
          this.warn.fuelLow = true;
          this.events.push({ type: 'fuel-low' });
        }
        if (this.fuel <= 0) {
          this.engState = 'off';
          this.engineOn = false;
          this.events.push({ type: 'fuel-out' });
        }
      }
      if (wheels > 0 || scraping) {
        this.ultT = 0;
        this.overG = false;
        return;
      }
      const lim = d.limits || { gPos: 4, gNeg: -2 };
      const nz = this.nzAll != null ? this.nzAll : 1;
      if (nz > lim.gPos * 1.5 || nz < lim.gNeg * 1.5) {
        this.ultT += h;
        if (this.ultT > 0.15) return this.crash('Yapısal hasar: aşırı G yükü kanatları kırdı');
      } else this.ultT = 0;
      this.overG = nz > lim.gPos + 0.1 || nz < lim.gNeg - 0.1;
      if (this.overG && !this.warn.g) {
        this.warn.g = true;
        this.events.push({ type: 'overstress', g: nz });
      }
      if (nz < lim.gPos * 0.9 && nz > lim.gNeg * 0.9) this.warn.g = false;
      const kt = (Va * Math.sqrt(atm.rho / 1.225)) / 0.514444;
      const sp = d.speeds;
      this.overspeed = kt > sp.vne;
      if (this.overspeed && !this.warn.vne) {
        this.warn.vne = true;
        this.events.push({ type: 'overspeed' });
      }
      if (kt < sp.vne * 0.97) this.warn.vne = false;
      if (kt > sp.vne * 1.12) {
        this.vneT += h;
        if (this.vneT > 1) return this.crash('Yapısal hasar: azami hız aşıldı, kanatlarda çırpınma (flutter)');
      } else this.vneT = 0;
      if (d.flaps && sp.vfe && this.flaps > 0.05 && !this.flapsJammed && kt > sp.vfe * 1.15) {
        this.flapOverT += h;
        if (this.flapOverT > 2) {
          this.flapsJammed = true;
          this.events.push({ type: 'flaps-damaged' });
        }
      } else this.flapOverT = 0;
      if (d.gear.retractable && sp.vlo && this.gearPos > 0.05 && !this.gearJammed && kt > sp.vlo * 1.2) {
        this.gearOverT += h;
        if (this.gearOverT > 2) {
          this.gearJammed = true;
          this.events.push({ type: 'gear-damaged' });
        }
      } else this.gearOverT = 0;
    }

    groundAt() {
      return this.ground;
    }

    step(dt, inp) {
      if (this.crashed) {
        this.updateDerived();
        return;
      }
      const n = Math.max(1, Math.ceil(dt / 0.004));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.substep(h, inp);
        if (this.crashed) break;
      }
      this.updateDerived();
    }

    crash(reason) {
      if (this.crashed) return;
      this.crashed = true;
      this.crashReason = reason;
      this.vel = [0, 0, 0];
      this.w = [0, 0, 0];
      this.events.push({ type: 'crash', reason });
    }

    substep(h, inp) {
      const d = this.def;
      const c = d.ctrl;
      const m = this.mass || d.mass;
      this.t += h;
      const real = this.realism.on;

      // --- eyleyiciler ---
      this.elev = approach(this.elev, clamp(+inp.elevator || 0, -1, 1), 5 * h);
      this.ail = approach(this.ail, clamp(+inp.aileron || 0, -1, 1), 5 * h);
      this.rud = approach(this.rud, clamp(+inp.rudder || 0, -1, 1), 4 * h);
      this.trim = clamp(+inp.trim || 0, -1, 1);
      if (d.flaps) {
        if (!this.flapsJammed) this.flaps = approach(this.flaps, inp.flaps, h / d.flaps.time);
      } else this.flaps = 0;
      if (d.gear.retractable && !this.gearJammed) {
        let target = inp.gearDown ? 1 : 0;
        if (this.wheelsDown > 0) target = 1; // yerdeyken takım toplanmaz
        this.gearPos = approach(this.gearPos, target, h / d.gear.time);
      }
      this.spoiler = d.spoilers ? approach(this.spoiler, inp.spoilers ? 1 : 0, 2 * h) : 0;
      const eng = d.engine;
      if (inp.engineOn != null && eng.type !== 'winch') {
        const want = !!inp.engineOn && (!real || !d.fuel || this.fuel > 0);
        if (!want) {
          this.engState = 'off';
          this.startT = 0;
        } else if (this.engState === 'off') {
          this.engState = real ? 'starting' : 'on';
          this.startT = 0;
        }
        if (this.engState === 'starting') {
          this.startT += h;
          if (this.startT >= (eng.startTime || 3)) {
            this.engState = 'on';
            this.events.push({ type: 'engine-started' });
          }
        }
        this.engineOn = this.engState === 'on';
      }
      let nTarget = 0;
      if (eng.type === 'winch') nTarget = this.winchDone ? 0 : clamp(inp.throttle, 0, 1);
      else if (this.engineOn) nTarget = eng.idle + (1 - eng.idle) * clamp(inp.throttle, 0, 1);
      else if (this.engState === 'starting' && eng.type === 'jet') nTarget = eng.idle * clamp(this.startT / (eng.startTime || 20), 0, 1);
      const spoolRate = eng.spool * (nTarget > this.n ? 1 : 1.3);
      this.n = approach(this.n, nTarget, spoolRate * h);
      this.afterburner = !!(eng.ab && this.engineOn && inp.throttle > 0.95 && this.n > 0.9);

      // --- ortam ---
      const atm = atmosphere(this.alt);
      const R = this.q;
      const agl = this.alt - this.ground - d.cgHeight;
      let wind = this.env.wind || [0, 0, 0];
      const turb = this.env.turbulence || 0;
      if (turb > 0) {
        const s = (1.5 + V.len(wind) * 0.25) * turb * clamp((agl + 5) / 60, 0, 1);
        wind = [
          wind[0] + s * noise1(this.t * 0.9, 1.3),
          wind[1] + s * noise1(this.t * 0.8, 4.1),
          wind[2] + s * 0.6 * noise1(this.t * 1.3, 7.7),
        ];
      }
      // yere yakın rüzgâr gradyanı
      const windScale = clamp(0.55 + 0.45 * (agl / 60), 0.55, 1);
      const vAirW = V.sub(this.vel, V.scale(wind, windScale));
      const vb = Q.invRotate(R, vAirW);
      const Va = V.len(vb);
      let alpha = 0, beta = 0;
      if (Va > 0.5) {
        alpha = Math.atan2(-vb[2], vb[1]);
        beta = Math.asin(clamp(vb[0] / Va, -1, 1));
      }
      const mach = Va / atm.a;
      const qbar = 0.5 * atm.rho * Va * Va;
      const S = d.S;

      // yer etkisi
      const hw = Math.max(0.2, this.alt + d.wingZ - this.ground);
      const r16 = (16 * hw) / d.span;
      const ge = hw < d.span * 1.5 ? (r16 * r16) / (1 + r16 * r16) : 1;

      // --- aerodinamik katsayılar ---
      const fl = this.flaps;
      const fd = d.flaps;
      const CL0 = d.CL0 + (fd ? fl * fd.dCL : 0);
      const CLmax = d.CLmax + (fd ? fl * fd.dCLmax : 0);
      const lc = liftCoef(alpha, CL0, d.CLa, CLmax, d.CLmin);
      let CL = lc.CL * (1 + 0.08 * (1 - ge));
      if (d.spoilers) CL *= 1 - d.spoilers.cl * this.spoiler;
      const stallAmt = lc.stall;
      const sa = Math.sin(alpha);
      let CD = d.CD0 + d.k * ge * CL * CL;
      if (fd) CD += fl * fd.dCD;
      CD += this.gearPos * d.gear.cd;
      if (d.spoilers) CD += this.spoiler * d.spoilers.cd;
      CD += waveDrag(mach, d.mcrit, d.waveCD);
      CD += 1.1 * sa * sa * smoothstep(d.alphaStall * 0.7, d.alphaStall + 0.15, Math.abs(alpha));

      // --- gövde kuvvetleri ---
      const Fb = [0, 0, 0];
      if (Va > 0.3) {
        const den = Math.hypot(vb[1], vb[2]);
        const L = qbar * S * CL;
        if (den > 1e-4) {
          Fb[1] += (L * -vb[2]) / den;
          Fb[2] += (L * vb[1]) / den;
        }
        const Dg = qbar * S * CD;
        Fb[0] -= (Dg * vb[0]) / Va;
        Fb[1] -= (Dg * vb[1]) / Va;
        Fb[2] -= (Dg * vb[2]) / Va;
        Fb[0] -= qbar * S * d.CYb * Math.sin(beta);
      }

      // itki
      let T = 0;
      const vf = Math.max(0, vb[1]);
      if (eng.type === 'prop') {
        T = this.n * eng.T0 * Math.pow(atm.sigma, 0.8) * Math.max(0, 1 - vf / eng.vmax);
      } else if (eng.type === 'jet') {
        T = this.n * eng.T0 * Math.pow(atm.sigma, 0.75) * Math.max(0.2, 1 - eng.lapse * mach);
        if (this.afterburner) T *= eng.ab * (1 + 0.25 * mach);
      } else if (eng.type === 'winch') {
        if (!this.winchDone && this.n > 0.01) {
          this.winchTime += h;
          const climbed = agl;
          if (climbed > eng.releaseAGL || this.winchTime > eng.maxTime || (this.airTime > 3 && Q.toHPR(R).pitch < -0.05)) {
            this.winchDone = true;
            this.events.push({ type: 'winch-release' });
          } else {
            // vinç operatörü hızı ~58 kt civarında tutar; yükseldikçe halat açısı çekişi azaltır
            const vt = eng.targetSpeed || 30;
            T = this.n * eng.T0 * clamp(1 - (Va - vt) / 8, 0, 1) * clamp(1 - climbed / (eng.releaseAGL * 1.8), 0.35, 1);
          }
        }
      }
      this.thrust = T;
      Fb[1] += T;

      // dünya eksenine
      const Fw = Q.rotate(R, Fb);
      // yük faktörü (yerçekimi hariç, gövde yukarı ekseni)
      const nzAero = Fb[2] / (m * g0);
      Fw[2] -= m * g0;
      const torque = [0, 0, 0];

      // --- iniş takımı ---
      let wheels = 0;
      let maxCompRate = 0;
      const gs = Math.hypot(this.vel[0], this.vel[1]);
      const gr = gs / 6;
      const steerSched = clamp(1 / (1 + gr * gr), 0.04, 1);
      this.gearSteer = this.rud * d.gear.steerMax * steerSched;
      const brk = clamp(Math.max(inp.brakes || 0, inp.parkingBrake ? 1 : 0), 0, 1);
      for (let i = 0; i < d.gear.points.length; i++) {
        const gp = d.gear.points[i];
        if (d.gear.retractable && this.gearPos < 0.98 && !gp.aux) {
          this.gearComp[i] = 0;
          continue;
        }
        const pw = Q.rotate(R, gp.pos);
        const pen = this.ground - (this.alt + pw[2]);
        if (pen <= 0) {
          this.gearComp[i] = 0;
          continue;
        }
        if (!gp.aux) wheels++;
        const vpB = V.cross(this.w, gp.pos);
        const vp = V.add(this.vel, Q.rotate(R, vpB));
        const compRate = -vp[2];
        if (!gp.aux) maxCompRate = Math.max(maxCompRate, compRate);
        let Fn = gp.k * Math.min(pen, gp.travel) + gp.c * compRate;
        if (pen > gp.travel) Fn += gp.k * 12 * (pen - gp.travel);
        Fn = Math.max(0, Fn);
        this.gearComp[i] = Math.min(pen, gp.travel);
        let a = 0;
        if (gp.steer) a = this.gearSteer * (gp.pos[1] >= 0 ? 1 : -1);
        let wf = Q.rotate(R, [Math.sin(a), Math.cos(a), 0]);
        wf[2] = 0;
        const wl = Math.hypot(wf[0], wf[1]);
        if (wl < 1e-3) wf = [0, 1, 0];
        else wf = [wf[0] / wl, wf[1] / wl, 0];
        const wr = [wf[1], -wf[0], 0];
        const vl = vp[0] * wf[0] + vp[1] * wf[1];
        const vlat = vp[0] * wr[0] + vp[1] * wr[1];
        const mu = gp.mu != null ? gp.mu : d.gear.rollMu + (gp.brake ? brk * d.gear.brakeMu : 0);
        const Fl = -Fn * mu * Math.tanh(vl / 0.25);
        const Flat = -Fn * gp.latMu * Math.tanh(vlat / 0.25);
        const Fc = [wf[0] * Fl + wr[0] * Flat, wf[1] * Fl + wr[1] * Flat, Fn];
        Fw[0] += Fc[0]; Fw[1] += Fc[1]; Fw[2] += Fc[2];
        const tb = V.cross(gp.pos, Q.invRotate(R, Fc));
        torque[0] += tb[0]; torque[1] += tb[1]; torque[2] += tb[2];
      }

      // --- gövde temasları ---
      let scraping = false;
      for (const ct of d.contacts) {
        const pw = Q.rotate(R, ct.pos);
        const pen = this.ground - (this.alt + pw[2]);
        if (pen <= 0) continue;
        const vp = V.add(this.vel, Q.rotate(R, V.cross(this.w, ct.pos)));
        const impact = -vp[2];
        const slide = Math.hypot(vp[0], vp[1]);
        if (ct.kind === 'fatal' && (impact > 1.5 || slide > 4)) {
          this.crash(ct.pos[0] !== 0 ? 'Kanat ucu yere çarptı' : 'Burun yere çarptı');
          return;
        }
        if (ct.kind === 'prop' && (this.n > 0.15 || slide > 3)) {
          this.crash('Pervane yere çarptı');
          return;
        }
        if (impact > 3.5) {
          this.crash('Gövde yere çarptı');
          return;
        }
        scraping = true;
        const kb = (m * g0) / 0.06;
        let Fn = kb * pen + 2 * 0.7 * Math.sqrt(kb * m * 0.5) * impact;
        Fn = Math.max(0, Fn);
        const vh = [vp[0], vp[1]];
        const sl = Math.hypot(vh[0], vh[1]);
        const fr = sl > 1e-4 ? (0.45 * Fn * Math.tanh(sl / 0.3)) / sl : 0;
        const Fc = [-vh[0] * fr, -vh[1] * fr, Fn];
        Fw[0] += Fc[0]; Fw[1] += Fc[1]; Fw[2] += Fc[2];
        const tb = V.cross(ct.pos, Q.invRotate(R, Fc));
        torque[0] += tb[0]; torque[1] += tb[1]; torque[2] += tb[2];
      }
      // yük faktörü: yerçekimi dışındaki tüm kuvvetlerin gövde yukarı bileşeni
      const fng = Q.invRotate(R, [Fw[0], Fw[1], Fw[2] + m * g0]);
      this.nzAll = fng[2] / (m * g0);
      if (scraping && !this.scraping) this.events.push({ type: 'scrape' });
      this.scraping = scraping;

      // iniş değerlendirmesi
      if (wheels > 0 && this.wheelsDown === 0 && this.airTime > 1.5) {
        this.events.push({ type: 'touchdown', vs: -this.vel[2], speed: Va });
      }
      if (maxCompRate > d.gear.maxV * (real ? 0.8 : 1)) {
        this.crash('Çok sert iniş — iniş takımı kırıldı');
        return;
      }
      if (wheels > 0 && d.gear.retractable && this.gearPos < 0.98) {
        // olmamalı ama güvenlik için
      }
      this.wheelsDown = wheels;
      if (wheels === 0 && !scraping) this.airTime += h;
      else this.airTime = 0;
      if (real) {
        this.realChecks(h, Va, atm, T, wheels, scraping);
        if (this.crashed) return;
      }

      // --- aerodinamik açısal ivmeler ---
      const qref = 0.5 * 1.225 * c.vref * c.vref;
      const qf = qbar / qref;
      const vfac = Math.sqrt(qf);
      let eCmd = this.elev + this.trim * c.trim;
      if (d.fbw && qbar > 200) {
        // uçuş kontrol bilgisayarı: G ve hücum açısı koruması
        const CLpos = Math.min(((d.fbw.gMax * m * g0) / (qbar * S)), CLmax);
        const CLneg = Math.max(((d.fbw.gMin * m * g0) / (qbar * S)), d.CLmin);
        const aMax = Math.min((CLpos - CL0) / d.CLa, (CLmax - CL0) / d.CLa - d.fbw.alphaMargin);
        const aMin = Math.max((CLneg - CL0) / d.CLa, (d.CLmin - CL0) / d.CLa + d.fbw.alphaMargin);
        const eMax = (aMax - c.alpha0) / d.dAlphaMax;
        const eMin = (aMin - c.alpha0) / d.dAlphaMax;
        eCmd = clamp(eCmd, Math.min(eMin, 0), Math.max(eMax, 0));
      }
      const aStab = Math.sin(alpha - c.alpha0);
      const sb = Math.sin(beta);
      const dw = [0, 0, 0];
      dw[0] = qf * (c.Pa * eCmd - c.Ka * aStab) - c.Dp * vfac * this.w[0];
      dw[1] = qf * (c.Ra * this.ail - c.Lb * sb) - c.Dr * vfac * this.w[1] - qf * c.Lr * this.w[2];
      dw[2] = qf * (-c.Nb * sb - c.Ya * this.rud + c.Na * this.ail) - c.Dy * vfac * this.w[2];
      if (stallAmt > 0 && wheels === 0) {
        // stall'da kanat düşmesi ve titreşim
        dw[1] += qf * 3 * stallAmt * noise1(this.t * 1.7, 2.2) * (real ? 2 : 1);
        dw[0] += qf * 1.5 * stallAmt * noise1(this.t * 9, 5.1);
        // gerçekçi modda otorotasyon: stall'da sapma yatışı büyütür (vril girişi)
        if (real) dw[1] -= qf * 4 * stallAmt * this.w[2];
      }
      if (real && eng.type === 'prop' && this.engineOn) {
        // pervane torku ve P-faktörü: düşük hızda yüksek güçte sola çeker
        const pw = clamp((this.n - eng.idle) / (1 - eng.idle), 0, 1);
        const f = pw * clamp(1.3 - Va / 60, 0.35, 1.3);
        dw[2] += (c.Pt || 0) * f;
        dw[1] -= (c.Pt || 0) * 0.4 * f;
      }
      // küçük sabit sönüm (çok düşük hızlarda kararlılık)
      dw[0] -= 0.25 * this.w[0];
      dw[1] -= 0.25 * this.w[1];
      dw[2] -= 0.25 * this.w[2];
      const I = d.inertia;
      dw[0] += torque[0] / I[0];
      dw[1] += torque[1] / I[1];
      dw[2] += torque[2] / I[2];

      // --- entegrasyon ---
      for (let k = 0; k < 3; k++) this.w[k] = clamp(this.w[k] + dw[k] * h, -6, 6);
      const wl = V.len(this.w);
      if (wl > 1e-9) {
        const dq = Q.axisAngle([this.w[0] / wl, this.w[1] / wl, this.w[2] / wl], wl * h);
        this.q = Q.normalize(Q.mul(this.q, dq));
      }
      const acc = [Fw[0] / m, Fw[1] / m, Fw[2] / m];
      this.vel[0] += acc[0] * h;
      this.vel[1] += acc[1] * h;
      this.vel[2] += acc[2] * h;
      const sl = Math.sin(this.lat);
      const den = 1 - WGS_E2 * sl * sl;
      const Nr = WGS_A / Math.sqrt(den);
      const Mr = (WGS_A * (1 - WGS_E2)) / (den * Math.sqrt(den));
      this.lat += (this.vel[1] * h) / (Mr + this.alt);
      this.lon += (this.vel[0] * h) / ((Nr + this.alt) * Math.max(0.01, Math.cos(this.lat)));
      if (this.lon > Math.PI) this.lon -= 2 * Math.PI;
      if (this.lon < -Math.PI) this.lon += 2 * Math.PI;
      this.lat = clamp(this.lat, -1.55, 1.55);
      this.alt += this.vel[2] * h;

      if (!(isFinite(this.alt) && isFinite(this.vel[0]) && isFinite(this.vel[1]) && isFinite(this.vel[2]) && isFinite(this.q[0]) && isFinite(this.w[0]))) {
        // sayısal hata: son geçerli duruma güvenli dönüş
        this.vel = [0, 0, 0]; this.w = [0, 0, 0];
        if (!isFinite(this.q[0])) this.q = Q.fromHPR(0, 0, 0);
        if (!isFinite(this.alt)) this.alt = this.ground + d.cgHeight + 50;
      }
      // türetilmiş (alt adım)
      this.alpha = alpha;
      this.beta = beta;
      this.mach = mach;
      this.tas = Va;
      this.rho = atm.rho;
      this.stallAmt = stallAmt;
      this.nz = this.nzAll != null ? this.nzAll : nzAero;
      this.qf = qf;
    }

    updateDerived() {
      const d = this.def;
      const hpr = Q.toHPR(this.q);
      this.heading = hpr.heading;
      this.pitch = hpr.pitch;
      this.roll = hpr.roll;
      if (this.tas == null) this.tas = V.len(this.vel);
      const atm = atmosphere(this.alt);
      this.ias = this.tas * Math.sqrt(atm.rho / 1.225);
      this.gs = Math.hypot(this.vel[0], this.vel[1]);
      this.vs = this.vel[2];
      this.agl = this.alt - this.ground - d.cgHeight;
      this.onGround = this.wheelsDown > 0 || this.scraping;
      const eng = d.engine;
      if (eng.type === 'prop' && this.engState === 'starting') {
        this.rpm = 180 + 40 * Math.sin(this.t * 25);
        this.engineDisplay = Math.round(this.rpm);
      } else if (eng.type === 'prop') {
        this.rpm = this.engineOn ? eng.rpmIdle + (eng.rpmMax - eng.rpmIdle) * Math.pow(Math.max(0, (this.n - eng.idle) / (1 - eng.idle)), 0.7) * 0.92 + 0.08 * (eng.rpmMax - eng.rpmIdle) * Math.min(1, this.tas / 60) : Math.min(1200, this.tas * 18);
        this.engineDisplay = Math.round(this.rpm);
      } else if (eng.type === 'jet') {
        this.rpm = this.engineOn ? 20 + 80 * this.n : this.engState === 'starting' ? 20 * clamp(this.n / eng.idle, 0, 1) : 0;
        this.engineDisplay = this.rpm;
      } else {
        this.rpm = 0;
        this.engineDisplay = 0;
      }
      this.stall = !this.onGround && (this.alpha || 0) > d.alphaStall - 0.035 && this.ias > 8;
    }

    // dışarıdan konum değiştirme (ışınlama) için yardımcı
    getPosition() {
      return { lat: this.lat, lon: this.lon, alt: this.alt };
    }

    popEvents() {
      const e = this.events;
      this.events = [];
      return e;
    }
  }

  GS.FlightModel = FlightModel;
  GS.prepareAircraft = prepareAircraft;
  GS.liftCoef = liftCoef;
})(typeof globalThis !== 'undefined' ? globalThis : window);
