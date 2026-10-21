/* GökSim — gösterge paneli (canvas)
 * Hız, ufuk, irtifa, dönüş, pusula, dikey hız + durum sütunu
 */
(function (G) {
  'use strict';
  const GS = (G.GS = G.GS || {});
  const { DEG, KT, FT, FPM, clamp } = GS;

  const C = {
    panel: '#36424b',
    panelEdge: '#2a333a',
    bezel: '#12171b',
    face: '#1b2227',
    ink: '#f1f3ef',
    dim: '#9aa6ab',
    magenta: '#d24ca9',
    amber: '#f2ab3c',
    green: '#46c27a',
    red: '#e5483d',
    sky: '#3a7fc0',
    sky2: '#6aa6dc',
    ground: '#7a5230',
    ground2: '#5b3c22',
  };
  const MONO = '"B612 Mono", ui-monospace, Menlo, monospace';
  const SANS = 'B612, system-ui, sans-serif';
  const TAU = Math.PI * 2;
  const clk = (a) => a - Math.PI / 2; // saat açısını canvas açısına çevir

  class Instruments {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.turnRate = 0;
      this.lastHdg = null;
      this.blink = 0;
      this.cockpit = false;
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.min(window.innerWidth - 12, 1060);
      const gap = 8;
      let d, rows, cols;
      if (W >= 720) {
        rows = 1;
        cols = 6;
        d = Math.min(138, (W - gap * 8) / 6.9);
      } else {
        rows = 2;
        cols = 3;
        d = Math.min(118, (W - gap * 5) / 3.95);
      }
      d = Math.max(64, Math.floor(d));
      const statusW = Math.round(d * 0.9);
      const w = cols * d + (cols + 1) * gap + statusW + gap;
      const h = rows * d + (rows + 1) * gap;
      this.layout = { d, rows, cols, gap, statusW, w, h };
      this.cv.style.width = w + 'px';
      this.cv.style.height = h + 'px';
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
      this.dpr = dpr;
    }

    // ---------- yardımcılar ----------
    bezel(cx, cy, r) {
      const x = this.ctx;
      x.beginPath();
      x.arc(cx, cy, r, 0, TAU);
      const g = x.createRadialGradient(cx, cy - r * 0.3, r * 0.2, cx, cy, r);
      g.addColorStop(0, '#2b3238');
      g.addColorStop(1, C.bezel);
      x.fillStyle = g;
      x.fill();
      x.beginPath();
      x.arc(cx, cy, r * 0.92, 0, TAU);
      x.fillStyle = C.face;
      x.fill();
    }
    tick(cx, cy, r1, r2, a, w, col) {
      const x = this.ctx;
      const c = Math.cos(a), s = Math.sin(a);
      x.beginPath();
      x.moveTo(cx + c * r1, cy + s * r1);
      x.lineTo(cx + c * r2, cy + s * r2);
      x.lineWidth = w;
      x.strokeStyle = col;
      x.stroke();
    }
    text(t, X, Y, size, col, font, align = 'center', base = 'middle') {
      const x = this.ctx;
      x.font = `${size}px ${font || SANS}`;
      x.fillStyle = col;
      x.textAlign = align;
      x.textBaseline = base;
      x.fillText(t, X, Y);
    }
    needle(cx, cy, a, len, w, col, tail = 0.18) {
      const x = this.ctx;
      x.save();
      x.translate(cx, cy);
      x.rotate(a);
      x.beginPath();
      x.moveTo(-len * tail, -w * 0.6);
      x.lineTo(len * 0.86, -w * 0.5);
      x.lineTo(len, 0);
      x.lineTo(len * 0.86, w * 0.5);
      x.lineTo(-len * tail, w * 0.6);
      x.closePath();
      x.fillStyle = col;
      x.shadowColor = 'rgba(0,0,0,0.5)';
      x.shadowBlur = 3;
      x.fill();
      x.restore();
    }
    hub(cx, cy, r) {
      const x = this.ctx;
      x.beginPath();
      x.arc(cx, cy, r, 0, TAU);
      x.fillStyle = '#2f373d';
      x.fill();
    }
    readout(t, cx, cy, size, col = C.ink) {
      const x = this.ctx;
      x.font = `700 ${size}px ${MONO}`;
      const w = x.measureText(t).width + size * 0.7;
      const h = size * 1.35;
      x.fillStyle = '#05080a';
      x.strokeStyle = '#3b444b';
      x.lineWidth = 1;
      roundRect(x, cx - w / 2, cy - h / 2, w, h, 3);
      x.fill();
      x.stroke();
      x.fillStyle = col;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(t, cx, cy + 1);
    }

    // ---------- göstergeler ----------
    airspeed(cx, cy, r, fm) {
      const sp = fm.def.speeds;
      const max = sp.max;
      const sweep = TAU * 0.9;
      const ang = (v) => clk((clamp(v, 0, max) / max) * sweep);
      const x = this.ctx;
      this.bezel(cx, cy, r);
      const R = r * 0.86;
      const arc = (v0, v1, rr, w, col) => {
        if (!(v1 > v0)) return;
        x.beginPath();
        x.arc(cx, cy, rr, ang(v0), ang(v1));
        x.lineWidth = w;
        x.strokeStyle = col;
        x.stroke();
      };
      if (sp.vfe) arc(sp.vs0, sp.vfe, R * 0.86, r * 0.05, C.ink);
      arc(sp.vs1, sp.vno, R * 0.93, r * 0.07, C.green);
      arc(sp.vno, sp.vne, R * 0.93, r * 0.07, C.amber);
      this.tick(cx, cy, R * 0.8, R, ang(sp.vne), r * 0.04, C.red);
      const step = max <= 160 ? 10 : max <= 400 ? 20 : 50;
      const lab = max <= 160 ? 20 : max <= 400 ? 40 : 100;
      for (let v = 0; v <= max; v += step) {
        const major = v % lab === 0;
        this.tick(cx, cy, major ? R * 0.74 : R * 0.8, R * 0.9, ang(v), major ? 2 : 1, C.ink);
        if (major && v > 0) {
          const a = ang(v);
          this.text(String(v), cx + Math.cos(a) * R * 0.56, cy + Math.sin(a) * R * 0.56, r * 0.15, C.ink, MONO);
        }
      }
      this.text('KT', cx, cy - r * 0.32, r * 0.12, C.dim);
      const kt = fm.ias / KT;
      this.readout(String(Math.round(kt)), cx, cy + r * 0.4, r * 0.16);
      this.needle(cx, cy, ang(kt), R * 0.86, r * 0.07, C.ink);
      this.hub(cx, cy, r * 0.08);
    }

    attitude(cx, cy, r, fm) {
      const x = this.ctx;
      this.bezel(cx, cy, r);
      const R = r * 0.86;
      const ppd = R / 28;
      const pitch = fm.pitch / DEG;
      const roll = fm.roll;
      x.save();
      x.beginPath();
      x.arc(cx, cy, R, 0, TAU);
      x.clip();
      x.translate(cx, cy);
      x.rotate(-roll);
      const off = pitch * ppd;
      const gs = x.createLinearGradient(0, -R * 2 + off, 0, off);
      gs.addColorStop(0, C.sky);
      gs.addColorStop(1, C.sky2);
      x.fillStyle = gs;
      x.fillRect(-R * 2, -R * 3 + off, R * 4, R * 3);
      const gg = x.createLinearGradient(0, off, 0, off + R * 2);
      gg.addColorStop(0, C.ground);
      gg.addColorStop(1, C.ground2);
      x.fillStyle = gg;
      x.fillRect(-R * 2, off, R * 4, R * 3);
      x.beginPath();
      x.moveTo(-R * 2, off);
      x.lineTo(R * 2, off);
      x.lineWidth = 2;
      x.strokeStyle = '#fff';
      x.stroke();
      for (let p = -30; p <= 30; p += 5) {
        if (p === 0) continue;
        const y = off - p * ppd;
        const wd = p % 10 === 0 ? R * 0.42 : R * 0.2;
        x.beginPath();
        x.moveTo(-wd / 2, y);
        x.lineTo(wd / 2, y);
        x.lineWidth = 1.3;
        x.strokeStyle = 'rgba(255,255,255,0.9)';
        x.stroke();
        if (p % 10 === 0) {
          this.text(String(Math.abs(p)), wd / 2 + R * 0.1, y, r * 0.1, '#fff', MONO);
          this.text(String(Math.abs(p)), -wd / 2 - R * 0.1, y, r * 0.1, '#fff', MONO);
        }
      }
      // yatış göstergesi (dönen üçgen)
      x.beginPath();
      x.moveTo(0, -R * 0.84);
      x.lineTo(-R * 0.07, -R * 0.72);
      x.lineTo(R * 0.07, -R * 0.72);
      x.closePath();
      x.fillStyle = C.amber;
      x.fill();
      x.restore();
      // sabit yatış ölçeği
      for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
        const a = clk(b * DEG);
        const big = b % 30 === 0;
        this.tick(cx, cy, R * (big ? 0.86 : 0.9), R, a, big ? 2 : 1.2, '#fff');
      }
      // uçak sembolü
      x.save();
      x.translate(cx, cy);
      x.lineWidth = r * 0.05;
      x.strokeStyle = C.amber;
      x.lineCap = 'round';
      x.beginPath();
      x.moveTo(-R * 0.55, 0);
      x.lineTo(-R * 0.18, 0);
      x.lineTo(-R * 0.09, R * 0.08);
      x.moveTo(R * 0.55, 0);
      x.lineTo(R * 0.18, 0);
      x.lineTo(R * 0.09, R * 0.08);
      x.stroke();
      x.beginPath();
      x.arc(0, 0, r * 0.035, 0, TAU);
      x.fillStyle = C.amber;
      x.fill();
      x.restore();
    }

    altimeter(cx, cy, r, fm) {
      const x = this.ctx;
      this.bezel(cx, cy, r);
      const R = r * 0.86;
      for (let i = 0; i < 50; i++) {
        const a = clk((i / 50) * TAU);
        const major = i % 5 === 0;
        this.tick(cx, cy, major ? R * 0.78 : R * 0.86, R * 0.95, a, major ? 2 : 1, C.ink);
        if (major) {
          this.text(String(i / 5), cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62, r * 0.17, C.ink, MONO);
        }
      }
      const ft = fm.alt / FT;
      const pos = Math.max(0, ft);
      this.text('FT', cx, cy - r * 0.3, r * 0.11, C.dim);
      this.readout(Math.round(ft).toLocaleString('tr-TR'), cx, cy + r * 0.38, r * 0.14);
      this.needle(cx, cy, clk(((pos % 10000) / 10000) * TAU), R * 0.55, r * 0.09, C.ink, 0.1);
      this.needle(cx, cy, clk(((pos % 1000) / 1000) * TAU), R * 0.88, r * 0.05, C.ink);
      this.hub(cx, cy, r * 0.08);
    }

    turn(cx, cy, r, fm, dt) {
      const x = this.ctx;
      this.bezel(cx, cy, r);
      const R = r * 0.86;
      if (this.lastHdg != null && dt > 0) {
        const d = GS.wrapPi(fm.heading - this.lastHdg) / dt;
        this.turnRate += (clamp(d, -0.5, 0.5) - this.turnRate) * Math.min(1, dt * 4);
      }
      this.lastHdg = fm.heading;
      const std = 3 * DEG;
      const tilt = clamp(this.turnRate / std, -2, 2) * 15 * DEG;
      for (const a of [0, 15 * DEG, Math.PI, Math.PI - 15 * DEG]) this.tick(cx, cy, R * 0.7, R * 0.88, a, 3, C.ink);
      this.text('L', cx - R * 0.72, cy + R * 0.32, r * 0.13, C.ink);
      this.text('R', cx + R * 0.72, cy + R * 0.32, r * 0.13, C.ink);
      x.save();
      x.translate(cx, cy);
      x.rotate(tilt);
      x.fillStyle = C.ink;
      x.fillRect(-R * 0.62, -R * 0.03, R * 1.24, R * 0.06);
      x.beginPath();
      x.arc(0, 0, R * 0.1, 0, TAU);
      x.fill();
      x.fillRect(-R * 0.025, -R * 0.24, R * 0.05, R * 0.18);
      x.fillRect(-R * 0.16, -R * 0.24, R * 0.32, R * 0.04);
      x.restore();
      // eğim topu
      const ty = cy + R * 0.48;
      x.fillStyle = '#05080a';
      roundRect(x, cx - R * 0.55, ty - R * 0.1, R * 1.1, R * 0.2, R * 0.1);
      x.fill();
      x.strokeStyle = C.dim;
      x.lineWidth = 1;
      for (const s of [-1, 1]) {
        x.beginPath();
        x.moveTo(cx + s * R * 0.11, ty - R * 0.1);
        x.lineTo(cx + s * R * 0.11, ty + R * 0.1);
        x.stroke();
      }
      const ball = clamp((fm.beta || 0) * 9, -1, 1);
      x.beginPath();
      x.arc(cx + ball * R * 0.42, ty, R * 0.085, 0, TAU);
      x.fillStyle = C.ink;
      x.fill();
      this.text('2 DK', cx, cy - R * 0.5, r * 0.1, C.dim);
    }

    heading(cx, cy, r, fm, ap) {
      const x = this.ctx;
      this.bezel(cx, cy, r);
      const R = r * 0.86;
      const hdg = fm.heading / DEG;
      x.save();
      x.translate(cx, cy);
      x.rotate(-hdg * DEG);
      for (let h = 0; h < 360; h += 5) {
        const a = clk(h * DEG);
        const major = h % 10 === 0;
        const c = Math.cos(a), s = Math.sin(a);
        x.beginPath();
        x.moveTo(c * R * (major ? 0.78 : 0.85), s * R * (major ? 0.78 : 0.85));
        x.lineTo(c * R * 0.94, s * R * 0.94);
        x.lineWidth = major ? 1.8 : 1;
        x.strokeStyle = C.ink;
        x.stroke();
        if (h % 30 === 0) {
          const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[h] || String(h / 10);
          x.save();
          x.translate(c * R * 0.62, s * R * 0.62);
          x.rotate(h * DEG);
          this.text(lbl, 0, 0, r * (h % 90 === 0 ? 0.17 : 0.14), h % 90 === 0 ? C.amber : C.ink, MONO);
          x.restore();
        }
      }
      if (ap) {
        const a = clk(ap.hdgDeg * DEG);
        x.save();
        x.rotate(a + Math.PI / 2);
        x.fillStyle = ap.on ? C.magenta : 'rgba(210,76,169,0.45)';
        x.fillRect(-R * 0.09, -R * 0.99, R * 0.18, R * 0.09);
        x.restore();
      }
      x.restore();
      // sabit uçak
      x.save();
      x.translate(cx, cy);
      x.fillStyle = C.amber;
      x.beginPath();
      x.moveTo(0, -R * 0.38);
      x.lineTo(R * 0.05, -R * 0.1);
      x.lineTo(R * 0.3, 0.02 * R);
      x.lineTo(R * 0.3, R * 0.08);
      x.lineTo(R * 0.05, R * 0.04);
      x.lineTo(R * 0.04, R * 0.22);
      x.lineTo(R * 0.12, R * 0.28);
      x.lineTo(R * 0.12, R * 0.32);
      x.lineTo(-R * 0.12, R * 0.32);
      x.lineTo(-R * 0.12, R * 0.28);
      x.lineTo(-R * 0.04, R * 0.22);
      x.lineTo(-R * 0.05, R * 0.04);
      x.lineTo(-R * 0.3, R * 0.08);
      x.lineTo(-R * 0.3, 0.02 * R);
      x.lineTo(-R * 0.05, -R * 0.1);
      x.closePath();
      x.fill();
      x.restore();
      x.beginPath();
      x.moveTo(cx, cy - R * 0.99);
      x.lineTo(cx - R * 0.06, cy - R * 1.08);
      x.lineTo(cx + R * 0.06, cy - R * 1.08);
      x.closePath();
      x.fillStyle = C.ink;
      x.fill();
      this.readout(String(Math.round(hdg) % 360).padStart(3, '0') + '°', cx, cy + R * 0.62, r * 0.13);
    }

    vsi(cx, cy, r, fm, dt) {
      const x = this.ctx;
      this.bezel(cx, cy, r);
      const R = r * 0.86;
      const max = fm.def.vsiMax;
      const ang = (v) => -Math.PI + (clamp(v, -max, max) / max) * (Math.PI * 0.92);
      const step = max / 8;
      for (let v = -max; v <= max + 1; v += step / 2) {
        const major = Math.abs(Math.round(v / step) * step - v) < 1;
        this.tick(cx, cy, major ? R * 0.76 : R * 0.84, R * 0.94, ang(v), major ? 2 : 1, C.ink);
        if (major && Math.round(v / step) % 2 === 0) {
          const a = ang(v);
          this.text(String(Math.abs(v / 1000)).replace('.', ','), cx + Math.cos(a) * R * 0.6, cy + Math.sin(a) * R * 0.6, r * 0.13, C.ink, MONO);
        }
      }
      this.text('UP', cx + R * 0.1, cy - R * 0.35, r * 0.09, C.dim);
      this.text('DN', cx + R * 0.1, cy + R * 0.35, r * 0.09, C.dim);
      this.text('×1000 FT/DK', cx + R * 0.2, cy, r * 0.075, C.dim);
      // gerçekçi modda klasik variometre gecikmesi (jette anlık)
      const raw = fm.vs / FPM;
      const tau = this.realistic && fm.def.engine.type !== 'jet' ? 2.2 : 0.12;
      this.vsiF = this.vsiF == null ? raw : this.vsiF + (raw - this.vsiF) * Math.min(1, (dt || 0.016) / tau);
      const fpm = this.vsiF;
      this.needle(cx, cy, ang(fpm), R * 0.88, r * 0.06, C.ink);
      this.hub(cx, cy, r * 0.08);
      this.readout((fpm >= 0 ? '+' : '') + Math.round(fpm / 10) * 10, cx, cy + R * 0.66, r * 0.12);
    }

    status(X, Y, w, h, fm, ctl, ap) {
      const x = this.ctx;
      const d = fm.def;
      x.fillStyle = C.face;
      roundRect(x, X, Y, w, h, 8);
      x.fill();
      const pad = w * 0.08;
      const fs = Math.max(9, w * 0.105);
      // gaz çubuğu
      const bx = X + pad, by = Y + pad, bw = w * 0.2, bh = h - pad * 2;
      x.fillStyle = '#05080a';
      roundRect(x, bx, by, bw, bh, 3);
      x.fill();
      const thr = ctl.throttle;
      const n = d.engine.type === 'winch' ? fm.n : (fm.n - d.engine.idle) / (1 - d.engine.idle || 1);
      x.fillStyle = fm.afterburner ? C.amber : C.green;
      x.fillRect(bx + 2, by + bh - 2 - (bh - 4) * clamp(n, 0, 1), bw - 4, (bh - 4) * clamp(n, 0, 1));
      x.fillStyle = C.ink;
      const ty = by + bh - 2 - (bh - 4) * thr;
      x.fillRect(bx - 3, ty - 1.5, bw + 6, 3);
      this.text('GAZ', bx + bw / 2, by + bh + pad * 0.1 - fs * 0.1, fs * 0.75, C.dim, SANS, 'center', 'bottom');
      // metin satırları
      const lx = bx + bw + pad;
      const rw = X + w - pad - lx;
      let ly = Y + pad + fs * 0.6;
      const line = (label, val, col = C.ink) => {
        this.text(label, lx, ly, fs * 0.8, C.dim, SANS, 'left');
        this.text(val, lx + rw, ly, fs, col, MONO, 'right');
        ly += fs * (this.realistic ? 1.3 : 1.45);
      };
      const running = fm.engineOn || fm.engState === 'starting';
      if (d.engine.type === 'prop') line('RPM', running ? String(Math.round(fm.rpm / 10) * 10) : '0', fm.engineOn ? C.ink : C.amber);
      else if (d.engine.type === 'jet') line('N1', running ? fm.rpm.toFixed(0) + '%' : '0%', fm.engineOn ? C.ink : C.amber);
      else line('VİNÇ', fm.winchDone ? 'YOK' : thr > 0.05 ? 'ÇEKİYOR' : 'HAZIR', fm.winchDone ? C.dim : C.green);
      if (d.flaps) {
        const i = ctl.flapIndex;
        line('FLAP', d.flaps.labels[i], Math.abs(fm.flaps - d.flaps.values[i]) > 0.01 ? C.amber : C.ink);
      }
      line('TRİM', (ctl.trim > 0 ? '▲' : ctl.trim < 0 ? '▼' : '') + Math.abs(Math.round(ctl.trim * 100)), C.ink);
      if (this.realistic && d.fuel) {
        const pct = (fm.fuel / d.fuel.cap) * 100;
        line('YAKIT', Math.round(pct) + '%', pct < 10 ? C.amber : C.ink);
      }
      // teker ışıkları
      this.text('TEKER', lx, ly, fs * 0.8, C.dim, SANS, 'left');
      const gc = fm.gearJammed ? C.amber : !d.gear.retractable || fm.gearPos > 0.99 ? C.green : fm.gearPos > 0.01 ? C.red : '#2c3439';
      for (let i = 0; i < 3; i++) {
        x.fillStyle = gc;
        x.fillRect(lx + rw - (3 - i) * fs * 0.85, ly - fs * 0.35, fs * 0.7, fs * 0.7);
      }
      ly += fs * 1.45;
      // ikaz ışıkları
      this.blink = (this.blink + 1) % 40;
      const anns = [];
      if (ap && ap.on) anns.push(['AP', C.magenta]);
      if (ctl.parkingBrake) anns.push(['PARK', C.amber]);
      else if (ctl.brakes > 0.1) anns.push(['FREN', C.amber]);
      if (fm.spoiler > 0.05) anns.push([d.engine.type === 'winch' ? 'FREN K.' : 'SPLR', C.amber]);
      if (fm.afterburner) anns.push(['A/B', C.amber]);
      if (fm.stall && this.blink < 25) anns.push(['STALL', C.red]);
      if (fm.overG && this.blink < 25) anns.push(['G', C.red]);
      if (fm.overspeed && this.blink < 25) anns.push(['HIZ', C.red]);
      if (fm.engState === 'starting') anns.push(['MARŞ', C.amber]);
      else if (!fm.engineOn && d.engine.type !== 'winch') anns.push(['MOTOR', C.amber]);
      if (this.realistic && d.fuel && fm.fuel < 0.1 * d.fuel.cap) anns.push(['YAKIT', C.amber]);
      if (fm.flapsJammed) anns.push(['FLAP ARZ', C.amber]);
      let ax = lx, ay = ly - fs * 0.2;
      for (const [t, col] of anns.slice(0, 6)) {
        x.font = `700 ${fs * 0.78}px ${MONO}`;
        const tw = x.measureText(t).width + fs * 0.6;
        if (ax + tw > X + w - pad) { ax = lx; ay += fs * 1.3; }
        x.strokeStyle = col;
        x.lineWidth = 1.2;
        roundRect(x, ax, ay - fs * 0.55, tw, fs * 1.1, 3);
        x.stroke();
        this.text(t, ax + tw / 2, ay, fs * 0.78, col, MONO);
        ax += tw + fs * 0.3;
      }
    }

    draw(fm, ctl, ap, dt) {
      const x = this.ctx;
      const L = this.layout;
      x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      x.clearRect(0, 0, L.w, L.h);
      x.fillStyle = this.cockpit ? 'rgba(42,51,58,0.97)' : 'rgba(54,66,75,0.88)';
      roundRect(x, 0, 0, L.w, L.h, 12);
      x.fill();
      x.strokeStyle = C.panelEdge;
      x.lineWidth = 2;
      x.stroke();
      const r = L.d / 2 - 2;
      const fns = [
        (cx, cy) => this.airspeed(cx, cy, r, fm),
        (cx, cy) => this.attitude(cx, cy, r, fm),
        (cx, cy) => this.altimeter(cx, cy, r, fm),
        (cx, cy) => this.turn(cx, cy, r, fm, dt),
        (cx, cy) => this.heading(cx, cy, r, fm, ap),
        (cx, cy) => this.vsi(cx, cy, r, fm, dt),
      ];
      for (let i = 0; i < 6; i++) {
        const row = Math.floor(i / L.cols), col = i % L.cols;
        const cx = L.gap + col * (L.d + L.gap) + L.d / 2;
        const cy = L.gap + row * (L.d + L.gap) + L.d / 2;
        fns[i](cx, cy);
      }
      const sx = L.gap + L.cols * (L.d + L.gap);
      this.status(sx, L.gap, L.statusW, L.h - L.gap * 2, fm, ctl, ap);
    }
  }

  function roundRect(x, X, Y, w, h, r) {
    x.beginPath();
    x.moveTo(X + r, Y);
    x.arcTo(X + w, Y, X + w, Y + h, r);
    x.arcTo(X + w, Y + h, X, Y + h, r);
    x.arcTo(X, Y + h, X, Y, r);
    x.arcTo(X, Y, X + w, Y, r);
    x.closePath();
  }

  GS.Instruments = Instruments;
})(typeof globalThis !== 'undefined' ? globalThis : window);
