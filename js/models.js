/* GökSim — prosedürel uçak modelleri (GLB üretici)
 * Tüm geometri gövde ekseninde (x sağ, y ileri, z yukarı) üretilir,
 * dışa aktarırken glTF eksenine çevrilir: (x, y, z)gövde -> (x, z, -y)glTF.
 * Cesium'da upAxis = Y, forwardAxis = X ile yüklenince model yerel ekseni = gövde ekseni olur.
 */
(function (G) {
  'use strict';
  const GS = (G.GS = G.GS || {});
  const { V } = GS;

  const MATS = {
    white: { c: [0.93, 0.94, 0.95, 1], m: 0.05, r: 0.42 },
    cream: { c: [0.95, 0.88, 0.68, 1], m: 0.05, r: 0.5 },
    navy: { c: [0.1, 0.2, 0.45, 1], m: 0.1, r: 0.4 },
    red: { c: [0.72, 0.12, 0.1, 1], m: 0.05, r: 0.45 },
    teal: { c: [0.05, 0.42, 0.5, 1], m: 0.1, r: 0.4 },
    gray: { c: [0.52, 0.56, 0.6, 1], m: 0.15, r: 0.55 },
    lgray: { c: [0.75, 0.77, 0.8, 1], m: 0.1, r: 0.5 },
    dgray: { c: [0.3, 0.32, 0.35, 1], m: 0.2, r: 0.6 },
    metal: { c: [0.62, 0.63, 0.65, 1], m: 0.8, r: 0.35 },
    dark: { c: [0.08, 0.09, 0.1, 1], m: 0.2, r: 0.6 },
    tire: { c: [0.06, 0.06, 0.06, 1], m: 0.0, r: 0.9 },
    glass: { c: [0.06, 0.1, 0.16, 1], m: 0.7, r: 0.08 },
    prop: { c: [0.15, 0.15, 0.16, 1], m: 0.3, r: 0.5 },
    yellow: { c: [0.95, 0.75, 0.1, 1], m: 0.0, r: 0.5 },
    navRed: { c: [1, 0.1, 0.1, 1], m: 0, r: 0.5, e: [1, 0.05, 0.05] },
    navGreen: { c: [0.1, 1, 0.2, 1], m: 0, r: 0.5, e: [0.05, 1, 0.15] },
    navWhite: { c: [1, 1, 1, 1], m: 0, r: 0.5, e: [1, 1, 1] },
    flame: { c: [1, 0.55, 0.2, 0.75], m: 0, r: 1, e: [1, 0.5, 0.15], blend: true },
  };

  // ---------- geometri yardımcıları ----------
  function sup(t, p) {
    const c = Math.cos(t), s = Math.sin(t);
    const e = 2 / p;
    return [Math.sign(c) * Math.pow(Math.abs(c), e), Math.sign(s) * Math.pow(Math.abs(s), e)];
  }
  // kesit halkası: [y, zc, w, h, p] ; xc isteğe bağlı
  function ring(sec, n, xc) {
    const [y, zc, w, h, p] = sec;
    const pts = [];
    for (let j = 0; j < n; j++) {
      const t = (j / n) * Math.PI * 2;
      const [a, b] = sup(t, p || 2);
      pts.push([(xc || 0) + w * a, y, zc + h * b]);
    }
    return pts;
  }

  class Builder {
    constructor() {
      this.nodes = [];
      this.node('fuselage');
    }
    node(name, pivot) {
      let n = this.nodes.find((x) => x.name === name);
      if (!n) {
        n = { name, pivot: pivot || [0, 0, 0], groups: new Map() };
        this.nodes.push(n);
      } else if (pivot) n.pivot = pivot;
      this.cur = n;
      return this;
    }
    g(mat) {
      let gr = this.cur.groups.get(mat);
      if (!gr) {
        gr = { pos: [], nrm: [], idx: [] };
        this.cur.groups.set(mat, gr);
      }
      return gr;
    }
    // düz yüzlü çokgen; inside: cismin içindeki bir nokta (yön düzeltme)
    poly(mat, pts, inside) {
      const gr = this.g(mat);
      let n = V.cross(V.sub(pts[1], pts[0]), V.sub(pts[2], pts[0]));
      if (V.len(n) < 1e-12 && pts.length > 3) n = V.cross(V.sub(pts[2], pts[0]), V.sub(pts[3], pts[0]));
      n = V.norm(n);
      const cen = pts.reduce((a, p) => V.add(a, p), [0, 0, 0]).map((v) => v / pts.length);
      let order = pts;
      if (inside && V.dot(n, V.sub(cen, inside)) < 0) {
        order = pts.slice().reverse();
        n = V.scale(n, -1);
      }
      const base = gr.pos.length / 3;
      for (const p of order) {
        gr.pos.push(p[0], p[1], p[2]);
        gr.nrm.push(n[0], n[1], n[2]);
      }
      for (let i = 1; i < order.length - 1; i++) gr.idx.push(base, base + i, base + i + 1);
    }
    // halkalar arası düz yüzlü gövde (kapaklı)
    hull(mat, rings, caps = true) {
      const all = rings.flat();
      const cen = all.reduce((a, p) => V.add(a, p), [0, 0, 0]).map((v) => v / all.length);
      const n = rings[0].length;
      for (let i = 0; i < rings.length - 1; i++) {
        const A = rings[i], B = rings[i + 1];
        const ca = A.reduce((a, p) => V.add(a, p), [0, 0, 0]).map((v) => v / n);
        const cb = B.reduce((a, p) => V.add(a, p), [0, 0, 0]).map((v) => v / n);
        const cc = V.scale(V.add(ca, cb), 0.5);
        for (let j = 0; j < n; j++) {
          const k = (j + 1) % n;
          this.poly(mat, [A[j], A[k], B[k], B[j]], cc);
        }
      }
      if (caps) {
        this.poly(mat, rings[0], cen);
        this.poly(mat, rings[rings.length - 1], cen);
      }
    }
    // yumuşak gölgeli loft (gövde, motor yatağı, kanopi)
    loft(mat, rings, caps = true) {
      const gr = this.g(mat);
      const n = rings[0].length;
      const m = rings.length;
      const base = gr.pos.length / 3;
      const acc = rings.map((r) => r.map(() => [0, 0, 0]));
      const centers = rings.map((r) => r.reduce((a, p) => V.add(a, p), [0, 0, 0]).map((v) => v / n));
      const tris = [];
      for (let i = 0; i < m - 1; i++) {
        const cc = V.scale(V.add(centers[i], centers[i + 1]), 0.5);
        for (let j = 0; j < n; j++) {
          const k = (j + 1) % n;
          const a = [i, j], b = [i, k], c = [i + 1, k], d = [i + 1, j];
          const P = (q) => rings[q[0]][q[1]];
          let nn = V.cross(V.sub(P(c), P(a)), V.sub(P(d), P(b)));
          const fc = V.scale(V.add(V.add(P(a), P(b)), V.add(P(c), P(d))), 0.25);
          let flip = false;
          if (V.dot(nn, V.sub(fc, cc)) < 0) { flip = true; nn = V.scale(nn, -1); }
          for (const q of [a, b, c, d]) acc[q[0]][q[1]] = V.add(acc[q[0]][q[1]], nn);
          if (!flip) tris.push([a, b, c], [a, c, d]);
          else tris.push([a, c, b], [a, d, c]);
        }
      }
      for (let i = 0; i < m; i++)
        for (let j = 0; j < n; j++) {
          const p = rings[i][j];
          let nn = V.norm(acc[i][j]);
          if (V.len(nn) < 0.5) nn = V.norm(V.sub(p, centers[i]));
          gr.pos.push(p[0], p[1], p[2]);
          gr.nrm.push(nn[0], nn[1], nn[2]);
        }
      for (const t of tris) gr.idx.push(...t.map((q) => base + q[0] * n + q[1]));
      if (caps) {
        const r0 = rings[0], r1 = rings[m - 1];
        if (V.len(V.sub(r0[0], centers[0])) > 0.02) this.poly(mat, r0, centers[1]);
        if (V.len(V.sub(r1[0], centers[m - 1])) > 0.02) this.poly(mat, r1, centers[m - 2]);
      }
    }
    // gövdenin yan yüzeyine boya bandı (kesitlerle aynı form, biraz dışarıda)
    band(mat, secs, t0, t1, steps, mirror = true, scale = 1.012) {
      const make = (a0, a1) => {
        const rings = secs.map((sec) => {
          const [y, zc, w, h, p] = sec;
          const pts = [];
          for (let s = 0; s <= steps; s++) {
            const t = a0 + ((a1 - a0) * s) / steps;
            const [a, b] = sup(t, p || 2);
            pts.push([w * a * scale, y, zc + h * b * scale]);
          }
          return { pts, c: [0, y, zc] };
        });
        const gr = this.g(mat);
        const base = gr.pos.length / 3;
        const cols = steps + 1;
        for (let i = 0; i < rings.length; i++)
          for (let s = 0; s < cols; s++) {
            const p = rings[i].pts[s];
            const nn = V.norm(V.sub(p, rings[i].c));
            gr.pos.push(p[0], p[1], p[2]);
            gr.nrm.push(nn[0], nn[1], nn[2]);
          }
        for (let i = 0; i < rings.length - 1; i++)
          for (let s = 0; s < steps; s++) {
            const a = base + i * cols + s, b = a + 1, c = a + cols + 1, d = a + cols;
            const pa = rings[i].pts[s], pb = rings[i].pts[s + 1], pd = rings[i + 1].pts[s];
            const nn = V.cross(V.sub(pb, pa), V.sub(pd, pa));
            const out = V.sub(pa, rings[i].c);
            if (V.dot(nn, out) >= 0) gr.idx.push(a, b, c, a, c, d);
            else gr.idx.push(a, c, b, a, d, c);
          }
      };
      make(t0, t1);
      if (mirror) make(Math.PI - t1, Math.PI - t0);
    }
    box(mat, mn, mx) {
      const r0 = [[mn[0], mn[1], mn[2]], [mx[0], mn[1], mn[2]], [mx[0], mn[1], mx[2]], [mn[0], mn[1], mx[2]]];
      const r1 = r0.map((p) => [p[0], mx[1], p[2]]);
      this.hull(mat, [r0, r1]);
    }
    // silindir/koni (p0 -> p1)
    cyl(mat, p0, p1, r0, r1, n = 12, caps = true, smooth = true) {
      const ax = V.norm(V.sub(p1, p0));
      let up = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const u = V.norm(V.cross(ax, up));
      const v = V.cross(ax, u);
      const mk = (c, r) => {
        const pts = [];
        for (let j = 0; j < n; j++) {
          const t = (j / n) * Math.PI * 2;
          pts.push(V.add(c, V.add(V.scale(u, Math.cos(t) * r), V.scale(v, Math.sin(t) * r))));
        }
        return pts;
      };
      const rings = [mk(p0, Math.max(r0, 0.001)), mk(p1, Math.max(r1, 0.001))];
      if (smooth) this.loft(mat, rings, caps);
      else this.hull(mat, rings, caps);
    }
    wheel(c, r, w, mat = 'tire', hub = 'lgray') {
      this.cyl(mat, [c[0] - w / 2, c[1], c[2]], [c[0] + w / 2, c[1], c[2]], r, r, 14, true, true);
      this.cyl(hub, [c[0] - w / 2 - 0.005, c[1], c[2]], [c[0] + w / 2 + 0.005, c[1], c[2]], r * 0.5, r * 0.5, 10, true, true);
    }
    // ince plaka (cam vb.)
    slab(mat, quad, thick, outward) {
      const o = V.scale(V.norm(outward), thick);
      const q2 = quad.map((p) => V.sub(p, o));
      this.hull(mat, [quad, q2]);
    }
    // kanat/kuyruk paneli; kesit: {p:[x,y,z] hücum kenarı, c: veter, t: kalınlık}
    panel(mat, a, b, vertical = false) {
      const sec = (s) => {
        const p = s.p, c = s.c, t = s.t;
        if (!vertical)
          return [p, [p[0], p[1] - 0.3 * c, p[2] + t / 2], [p[0], p[1] - c, p[2]], [p[0], p[1] - 0.3 * c, p[2] - t / 2]];
        return [p, [p[0] + t / 2, p[1] - 0.3 * c, p[2]], [p[0], p[1] - c, p[2]], [p[0] - t / 2, p[1] - 0.3 * c, p[2]]];
      };
      this.hull(mat, [sec(a), sec(b)]);
    }
  }

  // Kanat yardımcıları
  function lerpSec(a, b, t) {
    return { p: V.lerp(a.p, b.p, t), c: a.c + (b.c - a.c) * t, t: a.t + (b.t - a.t) * t };
  }
  function secAt(stations, s, vertical) {
    const key = (st) => (vertical ? st.p[2] : Math.abs(st.p[0]));
    for (let i = 0; i < stations.length - 1; i++) {
      const k0 = key(stations[i]), k1 = key(stations[i + 1]);
      if (s >= k0 - 1e-6 && s <= k1 + 1e-6) return lerpSec(stations[i], stations[i + 1], (s - k0) / (k1 - k0 || 1));
    }
    return s < key(stations[0]) ? stations[0] : stations[stations.length - 1];
  }
  const mirrorSec = (s) => ({ p: [-s.p[0], s.p[1], s.p[2]], c: s.c, t: s.t });

  // stations: sağ taraf (veya dikey) kesitleri; surfaces: {node, s0, s1, frac, mat, shared}
  function wing(mb, o) {
    const vertical = !!o.vertical;
    const st = o.stations;
    const key = (x) => (vertical ? x.p[2] : Math.abs(x.p[0]));
    const surf = o.surfaces || [];
    const brk = new Set(st.map(key));
    for (const s of surf) { brk.add(s.s0); brk.add(s.s1); }
    if (o.tipFrom != null) brk.add(o.tipFrom);
    const pts = [...brk].sort((a, b) => a - b);
    const sides = vertical ? [1] : o.mirror === false ? [1] : [1, -1];
    for (const side of sides) {
      for (let i = 0; i < pts.length - 1; i++) {
        const s0 = pts[i], s1 = pts[i + 1];
        if (s1 - s0 < 1e-4) continue;
        let A = secAt(st, s0, vertical), B = secAt(st, s1, vertical);
        const mid = (s0 + s1) / 2;
        const sf = surf.find((x) => mid > x.s0 && mid < x.s1);
        const mat = o.tipFrom != null && mid > o.tipFrom ? o.tipMat : o.mat;
        if (side < 0) { A = mirrorSec(A); B = mirrorSec(B); }
        mb.node(o.node || 'airframe');
        if (!sf) {
          mb.panel(mat, A, B, vertical);
          continue;
        }
        const cA = A.c * sf.frac, cB = B.c * sf.frac;
        mb.panel(mat, { p: A.p, c: A.c - cA, t: A.t }, { p: B.p, c: B.c - cB, t: B.t }, vertical);
        const hA = [A.p[0], A.p[1] - (A.c - cA), A.p[2]];
        const hB = [B.p[0], B.p[1] - (B.c - cB), B.p[2]];
        const name = sf.shared ? sf.node : sf.node + (side > 0 ? 'R' : 'L');
        // menteşe merkezi pivot
        const full0 = secAt(st, sf.s0, vertical), full1 = secAt(st, sf.s1, vertical);
        let pv0 = [full0.p[0], full0.p[1] - full0.c * (1 - sf.frac), full0.p[2]];
        let pv1 = [full1.p[0], full1.p[1] - full1.c * (1 - sf.frac), full1.p[2]];
        if (side < 0) { pv0 = [-pv0[0], pv0[1], pv0[2]]; pv1 = [-pv1[0], pv1[1], pv1[2]]; }
        let pivot = V.scale(V.add(pv0, pv1), 0.5);
        if (sf.shared && !vertical) pivot = [0, pivot[1], pivot[2]];
        mb.node(name, mb.nodes.find((n) => n.name === name) ? undefined : pivot);
        mb.panel(sf.mat || o.mat, { p: hA, c: cA, t: A.t * (1 - sf.frac * 0.6) }, { p: hB, c: cB, t: B.t * (1 - sf.frac * 0.6) }, vertical);
      }
    }
    mb.node('airframe');
  }

  function propeller(mb, hub, R, blades, spinnerR, spinnerL, mat = 'prop') {
    mb.node('prop', hub);
    mb.cyl('white', [hub[0], hub[1] - 0.05, hub[2]], [hub[0], hub[1] + spinnerL, hub[2]], spinnerR, 0.015, 14, true, true);
    for (let b = 0; b < blades; b++) {
      const ang = (b / blades) * Math.PI * 2;
      const dir = [Math.sin(ang), 0, Math.cos(ang)];
      const side = [Math.cos(ang), 0, -Math.sin(ang)];
      const sec = (r, c, t) => {
        const p = V.add(hub, V.scale(dir, r));
        return [V.add(p, V.scale(side, c / 2)), V.add(p, [0, t / 2, 0]), V.sub(p, V.scale(side, c / 2)), V.sub(p, [0, t / 2, 0])];
      };
      mb.hull(mat, [sec(0.08, 0.14, 0.05), sec(R * 0.7, 0.13, 0.03), sec(R, 0.08, 0.02)]);
      const tip = (r, c) => {
        const p = V.add(hub, V.scale(dir, r));
        return [V.add(p, V.scale(side, c / 2)), V.add(p, [0, 0.012, 0]), V.sub(p, V.scale(side, c / 2)), V.sub(p, [0, 0.012, 0])];
      };
      mb.hull('yellow', [tip(R * 0.9, 0.1), tip(R + 0.005, 0.085)]);
    }
  }

  // iniş takımı düğümleri: pivot = temas noktası
  function gearNode(mb, i, gp, build) {
    mb.node('gear' + i, gp.pos.slice());
    build(gp.pos);
  }

  // ---------------- MODELLER ----------------
  const BUILD = {};

  BUILD.trainer = function (mb, def) {
    const fus = [
      [2.62, -0.12, 0.3, 0.3, 2.2],
      [2.35, -0.1, 0.48, 0.45, 2.6],
      [1.7, -0.02, 0.54, 0.56, 3],
      [1.1, 0.05, 0.56, 0.66, 3.4],
      [0.3, 0.1, 0.57, 0.7, 3.4],
      [-0.7, 0.1, 0.55, 0.66, 3.4],
      [-1.8, 0.18, 0.4, 0.5, 3],
      [-3.2, 0.28, 0.24, 0.32, 2.6],
      [-4.6, 0.33, 0.12, 0.2, 2.4],
      [-5.55, 0.36, 0.05, 0.1, 2.2],
    ];
    mb.node('fuselage');
    mb.loft('white', fus.map((s) => ring(s, 18)));
    mb.band('navy', fus.slice(1, 9), -0.42, -0.2, 2);
    mb.band('red', fus.slice(1, 9), -0.17, -0.12, 1);
    // ön cam ve pencereler
    mb.slab('glass', [[-0.44, 1.5, 0.5], [0.44, 1.5, 0.5], [0.5, 0.86, 0.85], [-0.5, 0.86, 0.85]], 0.03, [0, 0.45, 1]);
    for (const sx of [1, -1]) {
      mb.slab('glass', [[0.578 * sx, 0.95, 0.22], [0.578 * sx, -0.85, 0.22], [0.52 * sx, -0.85, 0.66], [0.52 * sx, 0.95, 0.66]], 0.03, [sx, 0, 0.12]);
    }
    mb.slab('glass', [[-0.3, -1.0, 0.72], [0.3, -1.0, 0.72], [0.22, -1.7, 0.6], [-0.22, -1.7, 0.6]], 0.02, [0, -0.3, 1]);
    mb.cyl('dark', [0, 2.6, -0.32], [0, 2.63, -0.32], 0.12, 0.12, 10);
    mb.cyl('metal', [0.15, -0.2, -0.45], [0.15, -0.5, -0.8], 0.012, 0.012, 6, false);
    mb.node('airframe');
    // kanat
    wing(mb, {
      mat: 'white',
      stations: [
        { p: [0, 0.85, 0.86], c: 1.62, t: 0.2 },
        { p: [2.6, 0.85, 0.93], c: 1.62, t: 0.18 },
        { p: [5.5, 0.75, 1.01], c: 1.08, t: 0.11 },
      ],
      surfaces: [
        { node: 'flap', s0: 0.6, s1: 2.6, frac: 0.24 },
        { node: 'aileron', s0: 2.7, s1: 5.3, frac: 0.26 },
      ],
      tipFrom: 5.3,
      tipMat: 'navy',
    });
    // dikmeler
    for (const sx of [1, -1]) {
      mb.cyl('white', [0.5 * sx, 0.25, -0.38], [2.7 * sx, 0.55, 0.9], 0.04, 0.035, 8, true, true);
    }
    // yatay stabilize + irtifa dümeni
    wing(mb, {
      mat: 'white',
      stations: [
        { p: [0, -4.55, 0.33], c: 1.0, t: 0.09 },
        { p: [1.75, -4.78, 0.36], c: 0.77, t: 0.05 },
      ],
      surfaces: [{ node: 'elevator', s0: 0, s1: 1.75, frac: 0.4, shared: true }],
    });
    // dikey stabilize + istikamet dümeni
    wing(mb, {
      mat: 'white',
      vertical: true,
      stations: [
        { p: [0, -4.05, 0.42], c: 1.6, t: 0.1 },
        { p: [0, -5.0, 1.55], c: 0.92, t: 0.06 },
      ],
      surfaces: [{ node: 'rudder', s0: 0.42, s1: 1.55, frac: 0.33, shared: true, mat: 'navy' }],
    });
    // seyir ışıkları
    mb.node('airframe');
    mb.box('navRed', [-5.56, 0.55, 0.98], [-5.5, 0.7, 1.04]);
    mb.box('navGreen', [5.5, 0.55, 0.98], [5.56, 0.7, 1.04]);
    mb.box('navWhite', [-0.03, -5.62, 0.33], [0.03, -5.55, 0.39]);
    // pervane
    propeller(mb, [0, 2.66, -0.12], 0.86, 2, 0.17, 0.32);
    // iniş takımı
    const gp = def.gear.points;
    gearNode(mb, 0, gp[0], (p) => {
      const c = [p[0], p[1], p[2] + 0.19];
      mb.wheel(c, 0.19, 0.12);
      mb.cyl('metal', [c[0], c[1] + 0.05, c[2] + 0.05], [0, 1.32, -0.38], 0.035, 0.035, 8, true);
      mb.box('lgray', [c[0] - 0.09, c[1] - 0.05, c[2] + 0.02], [c[0] + 0.09, c[1] + 0.08, c[2] + 0.22]);
    });
    for (const i of [1, 2]) {
      gearNode(mb, i, gp[i], (p) => {
        const sx = Math.sign(p[0]);
        const c = [p[0], p[1], p[2] + 0.21];
        mb.wheel(c, 0.21, 0.14);
        mb.cyl('white', [c[0] - 0.06 * sx, c[1], c[2] + 0.1], [0.42 * sx, -0.35, -0.5], 0.045, 0.04, 8, true);
        const pc = [p[0], p[1], p[2] + 0.26];
        mb.loft('white', [
          [p[1] + 0.42, 0.02, 0.02],
          [p[1] + 0.25, 0.1, 0.17],
          [p[1] + 0.02, 0.11, 0.2],
          [p[1] - 0.22, 0.09, 0.16],
          [p[1] - 0.4, 0.02, 0.03],
        ].map(([y, w, h]) => ring([y, pc[2], w, h, 2.2], 12, pc[0])));
      });
    }
  };

  BUILD.cub = function (mb, def) {
    const fus = [
      [1.95, 0.05, 0.22, 0.22, 2.4],
      [1.7, 0.05, 0.36, 0.38, 3],
      [1.1, 0.1, 0.38, 0.5, 4],
      [0.2, 0.15, 0.36, 0.6, 4],
      [-0.8, 0.15, 0.33, 0.55, 4],
      [-2.2, 0.18, 0.22, 0.38, 3.5],
      [-3.8, 0.22, 0.12, 0.22, 3],
      [-4.85, 0.25, 0.04, 0.1, 2.4],
    ];
    mb.node('fuselage');
    mb.loft('cream', fus.map((s) => ring(s, 16)));
    mb.band('red', fus.slice(1, 7), -0.12, 0.02, 2);
    mb.slab('glass', [[-0.3, 1.15, 0.5], [0.3, 1.15, 0.5], [0.34, 0.66, 0.77], [-0.34, 0.66, 0.77]], 0.03, [0, 0.5, 1]);
    for (const sx of [1, -1]) {
      mb.slab('glass', [[0.372 * sx, 0.6, 0.3], [0.36 * sx, -0.7, 0.3], [0.33 * sx, -0.7, 0.68], [0.34 * sx, 0.6, 0.7]], 0.02, [sx, 0, 0.1]);
    }
    mb.node('airframe');
    wing(mb, {
      mat: 'cream',
      stations: [
        { p: [0, 0.65, 0.78], c: 1.6, t: 0.19 },
        { p: [5.35, 0.65, 0.95], c: 1.6, t: 0.17 },
      ],
      surfaces: [{ node: 'aileron', s0: 2.8, s1: 5.2, frac: 0.22 }],
    });
    for (const sx of [1, -1]) {
      mb.cyl('cream', [0.32 * sx, 0.55, -0.38], [2.7 * sx, 0.45, 0.82], 0.035, 0.03, 6, true);
      mb.cyl('cream', [0.32 * sx, 0.1, -0.38], [2.7 * sx, -0.55, 0.82], 0.035, 0.03, 6, true);
    }
    wing(mb, {
      mat: 'cream',
      stations: [
        { p: [0, -3.95, 0.25], c: 0.9, t: 0.06 },
        { p: [1.5, -4.05, 0.27], c: 0.75, t: 0.05 },
      ],
      surfaces: [{ node: 'elevator', s0: 0, s1: 1.5, frac: 0.42, shared: true }],
    });
    wing(mb, {
      mat: 'cream',
      vertical: true,
      stations: [
        { p: [0, -3.85, 0.35], c: 1.05, t: 0.07 },
        { p: [0, -4.25, 1.25], c: 0.55, t: 0.05 },
      ],
      surfaces: [{ node: 'rudder', s0: 0.35, s1: 1.25, frac: 0.42, shared: true, mat: 'red' }],
    });
    mb.node('airframe');
    mb.box('navRed', [-5.38, 0.4, 0.92], [-5.33, 0.55, 0.98]);
    mb.box('navGreen', [5.33, 0.4, 0.92], [5.38, 0.55, 0.98]);
    propeller(mb, [0, 2.0, 0.05], 0.9, 2, 0.12, 0.22);
    const gp = def.gear.points;
    for (const i of [0, 1]) {
      gearNode(mb, i, gp[i], (p) => {
        const sx = Math.sign(p[0]);
        const c = [p[0], p[1], p[2] + 0.22];
        mb.wheel(c, 0.22, 0.12);
        mb.cyl('cream', [c[0] - 0.05 * sx, c[1] + 0.02, c[2]], [0.25 * sx, 0.6, -0.42], 0.03, 0.03, 6, true);
        mb.cyl('cream', [c[0] - 0.05 * sx, c[1] - 0.02, c[2]], [0.25 * sx, 0.0, -0.42], 0.03, 0.03, 6, true);
      });
    }
    gearNode(mb, 2, gp[2], (p) => {
      const c = [p[0], p[1], p[2] + 0.08];
      mb.wheel(c, 0.08, 0.05);
      mb.cyl('dgray', [c[0], c[1] + 0.02, c[2] + 0.02], [0, -4.25, 0.12], 0.02, 0.02, 6, true);
    });
  };

  BUILD.airliner = function (mb, def) {
    const fus = [
      [18.6, -0.55, 0.06, 0.06, 2],
      [18.2, -0.45, 0.75, 0.75, 2],
      [17.4, -0.25, 1.3, 1.35, 2],
      [16.2, -0.05, 1.75, 1.85, 2],
      [14.5, 0, 1.95, 2.02, 2],
      [-9.0, 0, 1.95, 2.02, 2],
      [-12.5, 0.3, 1.65, 1.7, 2],
      [-16.0, 0.85, 0.95, 1.05, 2],
      [-18.6, 1.3, 0.3, 0.4, 2],
      [-19.4, 1.45, 0.08, 0.12, 2],
    ];
    mb.node('fuselage');
    mb.loft('white', fus.map((s) => ring(s, 24)));
    // gövde altı gri, kokpit camı, şerit
    mb.band('lgray', fus.slice(1, 8), -Math.PI / 2 - 0.85, -Math.PI / 2 + 0.85, 6, false);
    mb.band('glass', [[17.55, -0.22, 1.27, 1.32, 2], [17.05, -0.14, 1.5, 1.58, 2], [16.55, -0.07, 1.68, 1.78, 2]], 0.34, Math.PI - 0.34, 10, false, 1.01);
    mb.band('teal', fus.slice(2, 8), 0.02, 0.1, 2);
    const tw = Math.asin(0.55 / 2.02);
    for (let y = 13.2; y > -8.6; y -= 0.95) {
      for (const sx of [1, -1]) {
        const t = tw;
        const P = [sx * 1.95 * Math.cos(t) * 1.006, y, 2.02 * Math.sin(t) * 1.006];
        const n = [sx * Math.cos(t), 0, Math.sin(t)];
        const vv = [-sx * Math.sin(t) * 0.17, 0, Math.cos(t) * 0.17];
        const uu = [0, 0.13, 0];
        mb.slab('glass', [V.add(V.add(P, uu), vv), V.add(V.sub(P, uu), vv), V.sub(V.sub(P, uu), vv), V.sub(V.add(P, uu), vv)], 0.02, n);
      }
    }
    // kapılar (koyu çizgi)
    for (const sx of [1, -1]) {
      for (const y of [14.4, -10.2]) {
        const t = 0.12;
        const P = [sx * 1.95 * Math.cos(t) * 1.008, y, 2.02 * Math.sin(t) * 1.008];
        const n = [sx * Math.cos(t), 0, Math.sin(t)];
        mb.slab('lgray', [V.add(P, [0, 0.45, 0.95]), V.add(P, [0, -0.45, 0.95]), V.add(P, [0, -0.45, -0.95]), V.add(P, [0, 0.45, -0.95])], 0.01, n);
      }
    }
    mb.node('airframe');
    const wst = [
      { p: [1.6, 3.6, -1.35], c: 6.4, t: 0.75 },
      { p: [6.2, 1.45, -0.95], c: 3.9, t: 0.45 },
      { p: [17.0, -3.6, -0.05], c: 1.55, t: 0.16 },
    ];
    wing(mb, {
      mat: 'lgray',
      stations: wst,
      surfaces: [
        { node: 'flap', s0: 2.1, s1: 12.0, frac: 0.24 },
        { node: 'aileron', s0: 12.4, s1: 16.6, frac: 0.24 },
      ],
    });
    // spoilerlar
    for (const side of [1, -1]) {
      const a = secAt(wst, 6.6, false), b = secAt(wst, 11.6, false);
      const pa = [side * a.p[0], a.p[1] - a.c * 0.56, a.p[2] + a.t * 0.3];
      const pb = [side * b.p[0], b.p[1] - b.c * 0.56, b.p[2] + b.t * 0.3];
      mb.node('spoiler' + (side > 0 ? 'R' : 'L'), V.scale(V.add(pa, pb), 0.5));
      mb.panel('lgray', { p: pa, c: a.c * 0.18, t: 0.05 }, { p: pb, c: b.c * 0.18, t: 0.04 });
    }
    mb.node('airframe');
    // kanatçık uçları (sharklet)
    for (const sx of [1, -1]) {
      mb.panel('teal', { p: [17.0 * sx, -3.62, -0.05], c: 1.5, t: 0.1 }, { p: [17.35 * sx, -5.0, 1.9], c: 0.55, t: 0.05 }, true);
    }
    // motorlar
    for (const sx of [1, -1]) {
      const cx = 5.75 * sx, cz = -2.05;
      mb.loft('white', [
        [5.95, 0.86], [5.75, 1.0], [4.6, 1.02], [3.0, 0.98], [1.9, 0.82], [1.4, 0.62],
      ].map(([y, r]) => ring([y, cz, r, r, 2], 18, cx)), true);
      mb.cyl('metal', [cx, 5.9, cz], [cx, 6.0, cz], 0.9, 0.84, 18, false);
      mb.cyl('dark', [cx, 5.6, cz], [cx, 5.85, cz], 0.82, 0.82, 16, true);
      mb.cyl('metal', [cx, 1.45, cz], [cx, 0.5, cz], 0.45, 0.1, 12, true);
      mb.cyl('teal', [cx, 5.2, cz], [cx, 4.5, cz], 1.03, 1.03, 18, false);
      mb.hull('white', [
        [[cx - 0.12, 4.0, cz + 0.8], [cx + 0.12, 4.0, cz + 0.8], [cx + 0.12, 4.0, -1.1], [cx - 0.12, 4.0, -1.1]],
        [[cx - 0.12, 0.6, cz + 0.6], [cx + 0.12, 0.6, cz + 0.6], [cx + 0.12, 0.6, -1.05], [cx - 0.12, 0.6, -1.05]],
      ]);
    }
    wing(mb, {
      mat: 'white',
      stations: [
        { p: [0.0, -13.2, 1.15], c: 3.9, t: 0.38 },
        { p: [6.2, -16.9, 1.65], c: 1.45, t: 0.12 },
      ],
      surfaces: [{ node: 'elevator', s0: 1.1, s1: 6.0, frac: 0.3, shared: true }],
    });
    wing(mb, {
      mat: 'teal',
      vertical: true,
      stations: [
        { p: [0, -12.3, 1.85], c: 5.6, t: 0.45 },
        { p: [0, -16.6, 7.6], c: 2.1, t: 0.15 },
      ],
      surfaces: [{ node: 'rudder', s0: 2.0, s1: 7.4, frac: 0.3, shared: true }],
    });
    mb.node('airframe');
    mb.box('navRed', [-17.42, -3.9, 1.85], [-17.3, -3.7, 1.95]);
    mb.box('navGreen', [17.3, -3.9, 1.85], [17.42, -3.7, 1.95]);
    mb.box('navWhite', [-0.06, -19.45, 1.4], [0.06, -19.35, 1.5]);
    const gp = def.gear.points;
    gearNode(mb, 0, gp[0], (p) => {
      const c = [p[0], p[1], p[2] + 0.38];
      mb.wheel([c[0] - 0.27, c[1], c[2]], 0.38, 0.24);
      mb.wheel([c[0] + 0.27, c[1], c[2]], 0.38, 0.24);
      mb.cyl('lgray', [c[0], c[1], c[2]], [0, 10.85, -1.7], 0.11, 0.11, 10, true);
    });
    for (const i of [1, 2]) {
      gearNode(mb, i, gp[i], (p) => {
        const c = [p[0], p[1], p[2] + 0.58];
        mb.wheel([c[0] - 0.33, c[1], c[2]], 0.58, 0.34);
        mb.wheel([c[0] + 0.33, c[1], c[2]], 0.58, 0.34);
        mb.cyl('lgray', [c[0], c[1], c[2]], [c[0], -1.25, -1.25], 0.16, 0.16, 10, true);
        mb.cyl('dgray', [c[0] - 0.33, c[1], c[2]], [c[0] + 0.33, c[1], c[2]], 0.08, 0.08, 8, true);
      });
    }
  };

  BUILD.fighter = function (mb, def) {
    const fus = [
      [7.6, 0.05, 0.03, 0.03, 2],
      [6.8, 0.07, 0.28, 0.28, 2],
      [5.4, 0.08, 0.5, 0.52, 2],
      [3.8, 0.05, 0.62, 0.66, 2.2],
      [2.0, 0.0, 0.8, 0.72, 2.4],
      [-1.0, 0.0, 0.95, 0.72, 2.6],
      [-4.0, 0.05, 0.85, 0.66, 2.4],
      [-5.8, 0.05, 0.62, 0.6, 2.1],
      [-6.7, 0.05, 0.55, 0.55, 2],
    ];
    mb.node('fuselage');
    mb.loft('gray', fus.map((s) => ring(s, 20)));
    mb.band('lgray', fus.slice(2, 8), -Math.PI / 2 - 0.9, -Math.PI / 2 + 0.9, 6, false);
    mb.loft('dgray', [[7.62, 0.05, 0.02, 0.02, 2], [7.3, 0.06, 0.15, 0.15, 2], [6.75, 0.07, 0.285, 0.285, 2]].map((s) => ring(s, 20)), false);
    mb.loft('glass', [
      [4.9, 0.58, 0.04, 0.04, 2],
      [4.35, 0.6, 0.3, 0.33, 2],
      [3.3, 0.62, 0.36, 0.43, 2],
      [2.0, 0.6, 0.32, 0.37, 2],
      [1.0, 0.56, 0.18, 0.22, 2],
      [0.3, 0.52, 0.04, 0.05, 2],
    ].map((s) => ring(s, 18)));
    // hava alığı
    mb.hull('gray', [
      [[-0.48, 3.3, -0.95], [0.48, 3.3, -0.95], [0.5, 3.3, -0.3], [-0.5, 3.3, -0.3]],
      [[-0.5, -2.5, -0.85], [0.5, -2.5, -0.85], [0.6, -2.5, -0.3], [-0.6, -2.5, -0.3]],
    ]);
    mb.slab('dark', [[-0.42, 3.32, -0.9], [0.42, 3.32, -0.9], [0.44, 3.32, -0.36], [-0.44, 3.32, -0.36]], 0.05, [0, 1, 0]);
    mb.cyl('metal', [0, -6.7, 0.05], [0, -7.5, 0.05], 0.53, 0.46, 16, false);
    mb.cyl('dark', [0, -7.3, 0.05], [0, -7.45, 0.05], 0.44, 0.44, 14, true);
    mb.node('airframe');
    wing(mb, {
      mat: 'gray',
      stations: [
        { p: [0.8, 1.4, -0.15], c: 4.6, t: 0.22 },
        { p: [4.98, -2.1, -0.15], c: 1.15, t: 0.06 },
      ],
      surfaces: [{ node: 'aileron', s0: 1.0, s1: 3.6, frac: 0.22 }],
    });
    for (const sx of [1, -1]) {
      mb.hull('gray', [
        [[0.55 * sx, 5.0, -0.12], [0.9 * sx, 1.4, -0.12], [0.6 * sx, 1.4, -0.12]],
        [[0.55 * sx, 5.0, -0.07], [0.9 * sx, 1.4, -0.07], [0.6 * sx, 1.4, -0.07]],
      ]);
      mb.panel('gray', { p: [0.45 * sx, -3.6, -0.55], c: 1.2, t: 0.05 }, { p: [0.62 * sx, -4.2, -1.05], c: 0.7, t: 0.04 }, true);
      mb.cyl('white', [5.02 * sx, 0.6, -0.15], [5.02 * sx, -2.6, -0.15], 0.07, 0.07, 8, true);
    }
    // tamamı hareketli yatay kuyruk
    mb.node('elevator', [0, -5.2, -0.12]);
    for (const sx of [1, -1]) mb.panel('gray', { p: [0.65 * sx, -4.4, -0.12], c: 2.5, t: 0.1 }, { p: [3.0 * sx, -5.9, -0.2], c: 0.9, t: 0.05 });
    mb.node('airframe');
    wing(mb, {
      mat: 'gray',
      vertical: true,
      stations: [
        { p: [0, -2.9, 0.65], c: 3.4, t: 0.15 },
        { p: [0, -5.6, 3.55], c: 1.0, t: 0.06 },
      ],
      surfaces: [{ node: 'rudder', s0: 0.9, s1: 3.3, frac: 0.25, shared: true }],
    });
    mb.node('airframe');
    mb.box('navRed', [-5.12, 0.5, -0.2], [-5.06, 0.65, -0.1]);
    mb.box('navGreen', [5.06, 0.5, -0.2], [5.12, 0.65, -0.1]);
    // art yakıcı alevi
    mb.node('flame', [0, -7.5, 0.05]);
    mb.cyl('flame', [0, -7.45, 0.05], [0, -10.3, 0.05], 0.42, 0.04, 16, true);
    const gp = def.gear.points;
    gearNode(mb, 0, gp[0], (p) => {
      const c = [p[0], p[1], p[2] + 0.28];
      mb.wheel(c, 0.28, 0.16);
      mb.cyl('lgray', c, [0, 4.0, -0.85], 0.06, 0.06, 8, true);
    });
    for (const i of [1, 2]) {
      gearNode(mb, i, gp[i], (p) => {
        const sx = Math.sign(p[0]);
        const c = [p[0], p[1], p[2] + 0.36];
        mb.wheel(c, 0.36, 0.2);
        mb.cyl('lgray', [c[0] - 0.08 * sx, c[1], c[2]], [0.8 * sx, -0.3, -0.8], 0.07, 0.07, 8, true);
      });
    }
  };

  BUILD.glider = function (mb, def) {
    const fus = [
      [3.95, -0.1, 0.04, 0.04, 2],
      [3.6, -0.08, 0.22, 0.24, 2],
      [2.8, -0.02, 0.33, 0.42, 2],
      [1.6, 0.02, 0.33, 0.47, 2],
      [0.4, 0.05, 0.3, 0.42, 2],
      [-0.8, 0.12, 0.18, 0.28, 2],
      [-2.5, 0.22, 0.11, 0.17, 2],
      [-4.3, 0.3, 0.08, 0.13, 2],
      [-4.7, 0.32, 0.04, 0.08, 2],
    ];
    mb.node('fuselage');
    mb.loft('white', fus.map((s) => ring(s, 18)));
    mb.loft('glass', [
      [3.35, 0.22, 0.03, 0.03, 2],
      [3.0, 0.24, 0.22, 0.22, 2],
      [2.2, 0.27, 0.28, 0.33, 2],
      [1.2, 0.26, 0.25, 0.3, 2],
      [0.6, 0.24, 0.12, 0.16, 2],
      [0.35, 0.22, 0.03, 0.03, 2],
    ].map((s) => ring(s, 18)));
    mb.node('airframe');
    const wst = [
      { p: [0.3, 0.55, 0.28], c: 1.3, t: 0.17 },
      { p: [8.5, 0.35, 0.78], c: 0.45, t: 0.06 },
    ];
    wing(mb, {
      mat: 'white',
      stations: wst,
      surfaces: [{ node: 'aileron', s0: 4.6, s1: 8.0, frac: 0.25 }],
      tipFrom: 7.6,
      tipMat: 'red',
    });
    for (const side of [1, -1]) {
      const a = secAt(wst, 2.0, false), b = secAt(wst, 3.4, false);
      const pa = [side * a.p[0], a.p[1] - a.c * 0.45, a.p[2] + a.t * 0.4];
      const pb = [side * b.p[0], b.p[1] - b.c * 0.45, b.p[2] + b.t * 0.4];
      mb.node('spoiler' + (side > 0 ? 'R' : 'L'), V.scale(V.add(pa, pb), 0.5));
      mb.panel('lgray', { p: pa, c: 0.16, t: 0.02 }, { p: pb, c: 0.15, t: 0.02 });
    }
    wing(mb, {
      mat: 'white',
      vertical: true,
      stations: [
        { p: [0, -3.75, 0.32], c: 1.0, t: 0.1 },
        { p: [0, -4.2, 1.48], c: 0.7, t: 0.07 },
      ],
      surfaces: [{ node: 'rudder', s0: 0.4, s1: 1.45, frac: 0.38, shared: true, mat: 'red' }],
    });
    wing(mb, {
      mat: 'white',
      stations: [
        { p: [0, -4.12, 1.5], c: 0.65, t: 0.07 },
        { p: [1.6, -4.3, 1.52], c: 0.42, t: 0.05 },
      ],
      surfaces: [{ node: 'elevator', s0: 0, s1: 1.6, frac: 0.38, shared: true }],
    });
    const gp = def.gear.points;
    gearNode(mb, 0, gp[0], (p) => mb.wheel([p[0], p[1], p[2] + 0.13], 0.13, 0.08));
    gearNode(mb, 1, gp[1], (p) => mb.wheel([p[0], p[1], p[2] + 0.2], 0.2, 0.1));
    mb.node('airframe');
    mb.box('dgray', [-0.03, -4.45, -0.12], [0.03, -4.3, 0.05]);
  };

  // ---------- GLB dışa aktarma ----------
  const toG = (p) => [p[0], p[2], -p[1]];

  function exportGLB(mb) {
    const matNames = [];
    const matIndex = (n) => {
      let i = matNames.indexOf(n);
      if (i < 0) { matNames.push(n); i = matNames.length - 1; }
      return i;
    };
    const chunks = [];
    let byteLen = 0;
    const bufferViews = [], accessors = [], meshes = [], nodes = [];
    const pushData = (typed, target) => {
      const pad = (4 - (byteLen % 4)) % 4;
      if (pad) { chunks.push(new Uint8Array(pad)); byteLen += pad; }
      const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
      chunks.push(u8);
      bufferViews.push({ buffer: 0, byteOffset: byteLen, byteLength: u8.byteLength, target });
      byteLen += u8.byteLength;
      return bufferViews.length - 1;
    };
    const rootChildren = [];
    const info = {};
    for (const nd of mb.nodes) {
      const prims = [];
      for (const [mat, gr] of nd.groups) {
        if (!gr.idx.length) continue;
        const n = gr.pos.length / 3;
        const pos = new Float32Array(n * 3);
        const nrm = new Float32Array(n * 3);
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < n; i++) {
          const p = toG([gr.pos[i * 3] - nd.pivot[0], gr.pos[i * 3 + 1] - nd.pivot[1], gr.pos[i * 3 + 2] - nd.pivot[2]]);
          const q = toG([gr.nrm[i * 3], gr.nrm[i * 3 + 1], gr.nrm[i * 3 + 2]]);
          for (let k = 0; k < 3; k++) {
            pos[i * 3 + k] = p[k];
            nrm[i * 3 + k] = q[k];
            if (p[k] < mn[k]) mn[k] = p[k];
            if (p[k] > mx[k]) mx[k] = p[k];
          }
        }
        const big = n > 65535;
        const idx = big ? new Uint32Array(gr.idx) : new Uint16Array(gr.idx);
        const bvP = pushData(pos, 34962);
        accessors.push({ bufferView: bvP, componentType: 5126, count: n, type: 'VEC3', min: mn, max: mx });
        const aP = accessors.length - 1;
        const bvN = pushData(nrm, 34962);
        accessors.push({ bufferView: bvN, componentType: 5126, count: n, type: 'VEC3' });
        const aN = accessors.length - 1;
        const bvI = pushData(idx, 34963);
        accessors.push({ bufferView: bvI, componentType: big ? 5125 : 5123, count: idx.length, type: 'SCALAR' });
        const aI = accessors.length - 1;
        prims.push({ attributes: { POSITION: aP, NORMAL: aN }, indices: aI, material: matIndex(mat), mode: 4 });
      }
      const node = { name: nd.name, translation: toG(nd.pivot) };
      if (prims.length) {
        meshes.push({ name: nd.name, primitives: prims });
        node.mesh = meshes.length - 1;
      }
      nodes.push(node);
      rootChildren.push(nodes.length - 1);
      info[nd.name] = { pivotG: toG(nd.pivot), pivot: nd.pivot.slice() };
    }
    nodes.push({ name: 'root', children: rootChildren });
    const materials = matNames.map((n) => {
      const m = MATS[n] || MATS.white;
      const mat = {
        name: n,
        pbrMetallicRoughness: { baseColorFactor: m.c, metallicFactor: m.m, roughnessFactor: m.r },
        doubleSided: true,
      };
      if (m.e) mat.emissiveFactor = m.e;
      if (m.blend) mat.alphaMode = 'BLEND';
      return mat;
    });
    const gltf = {
      asset: { version: '2.0', generator: 'GokSim procedural' },
      scene: 0,
      scenes: [{ nodes: [nodes.length - 1] }],
      nodes,
      meshes,
      materials,
      accessors,
      bufferViews,
      buffers: [{ byteLength: byteLen + ((4 - (byteLen % 4)) % 4) }],
    };
    const binPad = (4 - (byteLen % 4)) % 4;
    if (binPad) { chunks.push(new Uint8Array(binPad)); byteLen += binPad; }
    const enc = new TextEncoder();
    let json = enc.encode(JSON.stringify(gltf));
    const jPad = (4 - (json.length % 4)) % 4;
    if (jPad) {
      const j2 = new Uint8Array(json.length + jPad);
      j2.set(json);
      for (let i = json.length; i < j2.length; i++) j2[i] = 0x20;
      json = j2;
    }
    const total = 12 + 8 + json.length + 8 + byteLen;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, json.length, true);
    dv.setUint32(16, 0x4e4f534a, true);
    out.set(json, 20);
    let off = 20 + json.length;
    dv.setUint32(off, byteLen, true);
    dv.setUint32(off + 4, 0x004e4942, true);
    off += 8;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return { glb: out, nodes: info };
  }

  const cache = {};
  function buildModel(def) {
    if (cache[def.id]) return cache[def.id];
    const mb = new Builder();
    BUILD[def.model](mb, def);
    const res = exportGLB(mb);
    cache[def.id] = res;
    return res;
  }

  GS.buildModel = buildModel;
  GS.MODEL_MATS = MATS;
})(typeof globalThis !== 'undefined' ? globalThis : window);
