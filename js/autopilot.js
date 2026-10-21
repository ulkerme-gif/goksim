/* GökSim — otopilot
 * Baş tutma (yatış komutu), irtifa tutma (dikey hız sınırlı), hız tutma (gaz).
 * Motorsuz planörde hız, burun açısıyla tutulur.
 */
(function (G) {
  'use strict';
  const GS = (G.GS = G.GS || {});
  const { clamp, wrapPi, DEG, KT, FT, FPM } = GS;

  class Autopilot {
    constructor() {
      this.on = false;
      this.altFt = 3000;
      this.vsFpm = 700;
      this.hdgDeg = 0;
      this.spdKt = 100;
      this.iGam = 0;
      this.iSpd = 0.5;
    }

    setDefaults(def) {
      this.altFt = def.ap.alt;
      this.vsFpm = def.ap.vs;
      this.spdKt = def.ap.spd;
    }

    engage(fm, inp) {
      this.on = true;
      this.hdgDeg = Math.round(fm.heading / DEG) % 360;
      this.altFt = Math.max(500, Math.round(fm.alt / FT / 100) * 100);
      if (fm.def.engine.type !== 'winch') this.spdKt = Math.round(fm.ias / KT);
      this.iGam = 0;
      this.iSpd = inp.throttle;
    }

    disengage() {
      this.on = false;
    }

    update(dt, fm, inp) {
      if (!this.on || fm.crashed) return;
      const d = fm.def;
      const c = d.ctrl;
      const V = Math.max(fm.tas, 15);
      const vfac = clamp(Math.sqrt(fm.qf || 0.1), 0.3, 3);

      // --- yanal: baş tutma ---
      const herr = wrapPi(this.hdgDeg * DEG - fm.heading);
      const maxBank = (d.id === 'airliner' ? 25 : 30) * DEG;
      const bankCmd = clamp(herr * 1.5, -maxBank, maxBank);
      const rateMax = (c.Ra / c.Dr) * vfac;
      const rateCmd = clamp(1.2 * (bankCmd - fm.roll), -0.2, 0.2);
      inp.aileron = clamp((rateCmd + (rateCmd - fm.w[1]) * 1.5) / rateMax, -1, 1);
      inp.rudder = clamp(inp.rudder + fm.beta * 3 + (c.Na / c.Ya) * inp.aileron, -1, 1);

      // --- dikey ---
      const qS = 0.5 * fm.rho * V * V * d.S;
      const CL0 = d.CL0 + (d.flaps ? fm.flaps * d.flaps.dCL : 0);
      const cosb = Math.max(0.6, Math.cos(fm.roll));
      let gErr;
      const glider = d.engine.type === 'winch';
      if (glider) {
        // planör: hızı burunla tut
        // planör: hızı burunla tut (hedef süzülme açısı + hız hatası + ivme sönümü)
        const ias = fm.ias;
        if (this.lastIas == null) this.lastIas = ias;
        const acc = (ias - this.lastIas) / Math.max(dt, 1e-3);
        this.lastIas = ias;
        this.accF = (this.accF || 0) + (acc - (this.accF || 0)) * Math.min(1, dt * 2);
        const gT = clamp(-0.035 + (0.5 * (ias - this.spdKt * KT) + 1.5 * this.accF) / V, -0.25, 0.15);
        gErr = clamp(gT - fm.vs / V, -0.2, 0.2);
        this.iGam = 0;
      } else {
        const vsLim = Math.max(1, Math.abs(this.vsFpm) * FPM);
        let vsCmd = clamp((this.altFt * FT - fm.alt) * 0.1, -vsLim, vsLim);
        // hız koruması: yavaşlayınca tırmanmayı azalt, gerekirse burnu indir
        // gerçekçi modda yalnızca uçuş kontrol bilgisayarı olan uçaklarda hız koruması var
        const protect = !(fm.realism && fm.realism.on) || !!d.fbw;
        const vmin = d.speeds.vs1 * 1.3 * KT;
        const deficit = protect ? clamp((vmin - fm.ias) / (0.15 * vmin), 0, 1) : 0;
        if (deficit > 0 && vsCmd > -1) vsCmd = vsCmd * (1 - deficit) - deficit * 1.5;
        // aşırı hız koruması
        const vmax = d.speeds.vne * 0.95 * KT;
        const excess = protect ? clamp((fm.ias - vmax) / (0.08 * vmax), 0, 1) : 0;
        if (excess > 0) vsCmd = vsCmd * (1 - excess) + excess * 2;
        gErr = clamp((vsCmd - fm.vs) / V, -0.2, 0.2);
      }
      this.iGam = clamp(this.iGam + gErr * dt * 0.5, -0.15, 0.15);
      const CLreq = ((fm.mass || d.mass) * 9.81) / (qS * cosb);
      const aReq = (CLreq - CL0) / d.CLa;
      const eFF = (aReq - c.alpha0) / d.dAlphaMax - fm.trim * c.trim;
      const eFB = (0.8 * gErr + this.iGam - 0.25 * fm.w[0]) / d.dAlphaMax;
      inp.elevator = clamp(eFF + eFB, -0.8, 0.8);

      // --- hız (gaz) ---
      if (!glider) {
        const serr = this.spdKt * KT - fm.ias;
        const kp = 0.04, ki = 0.012;
        this.iSpd = clamp(this.iSpd + serr * ki * dt, 0, 1);
        inp.throttle = clamp(this.iSpd + serr * kp, 0, 1);
      }
    }
  }

  GS.Autopilot = Autopilot;
})(typeof globalThis !== 'undefined' ? globalThis : window);
