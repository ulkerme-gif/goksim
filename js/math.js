/* GökSim — vektör ve kuaterniyon yardımcıları
 * Gövde ekseni: x = sağ kanat, y = burun (ileri), z = yukarı
 * Dünya ekseni (yerel): x = Doğu, y = Kuzey, z = Yukarı (ENU)
 * Kuaterniyon [w, x, y, z] gövdeden dünyaya döndürür.
 */
(function (G) {
  'use strict';
  const GS = (G.GS = G.GS || {});

  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => {
      const l = Math.hypot(a[0], a[1], a[2]);
      return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
    },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  };

  const Q = {
    identity: () => [1, 0, 0, 0],
    mul: (a, b) => [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ],
    axisAngle: (ax, ang) => {
      const s = Math.sin(ang / 2);
      return [Math.cos(ang / 2), ax[0] * s, ax[1] * s, ax[2] * s];
    },
    normalize: (q) => {
      const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
    },
    conj: (q) => [q[0], -q[1], -q[2], -q[3]],
    // v' = q v q*
    rotate: (q, v) => {
      const w = q[0], x = q[1], y = q[2], z = q[3];
      const tx = 2 * (y * v[2] - z * v[1]);
      const ty = 2 * (z * v[0] - x * v[2]);
      const tz = 2 * (x * v[1] - y * v[0]);
      return [
        v[0] + w * tx + (y * tz - z * ty),
        v[1] + w * ty + (z * tx - x * tz),
        v[2] + w * tz + (x * ty - y * tx),
      ];
    },
    invRotate: (q, v) => Q.rotate([q[0], -q[1], -q[2], -q[3]], v),
    // pusula başı (saat yönü, kuzeyden), yunuslama (burun yukarı +), yatış (sağ kanat aşağı +)
    fromHPR: (h, p, r) => {
      const qh = Q.axisAngle([0, 0, 1], -h);
      const qp = Q.axisAngle([1, 0, 0], p);
      const qr = Q.axisAngle([0, 1, 0], r);
      return Q.normalize(Q.mul(Q.mul(qh, qp), qr));
    },
    toHPR: (q) => {
      const f = Q.rotate(q, [0, 1, 0]);
      const r = Q.rotate(q, [1, 0, 0]);
      const u = Q.rotate(q, [0, 0, 1]);
      let h = Math.atan2(f[0], f[1]);
      if (h < 0) h += Math.PI * 2;
      const p = Math.asin(Math.max(-1, Math.min(1, f[2])));
      const roll = Math.atan2(-r[2], u[2]);
      return { heading: h, pitch: p, roll };
    },
    // satır-ana 3x3 matris: sütunlar = gövde eksenlerinin dünya karşılıkları
    toMat3: (q) => {
      const c0 = Q.rotate(q, [1, 0, 0]);
      const c1 = Q.rotate(q, [0, 1, 0]);
      const c2 = Q.rotate(q, [0, 0, 1]);
      return [
        [c0[0], c1[0], c2[0]],
        [c0[1], c1[1], c2[1]],
        [c0[2], c1[2], c2[2]],
      ];
    },
  };

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const approach = (cur, target, maxStep) => {
    const d = target - cur;
    if (d > maxStep) return cur + maxStep;
    if (d < -maxStep) return cur - maxStep;
    return target;
  };
  const wrapPi = (a) => {
    a = (a + Math.PI) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a - Math.PI;
  };
  const wrap2Pi = (a) => {
    a = a % (Math.PI * 2);
    return a < 0 ? a + Math.PI * 2 : a;
  };
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const DEG = Math.PI / 180;
  const KT = 0.514444; // m/s
  const FT = 0.3048; // m
  const FPM = 0.00508; // m/s

  // Standart atmosfer (ISA)
  function atmosphere(h) {
    h = Math.max(-500, h);
    let T, p;
    if (h < 11000) {
      T = 288.15 - 0.0065 * h;
      p = 101325 * Math.pow(T / 288.15, 5.25588);
    } else {
      T = 216.65;
      p = 22632.1 * Math.exp(-0.000157688 * (h - 11000));
    }
    const rho = p / (287.053 * T);
    const a = Math.sqrt(1.4 * 287.053 * T);
    return { T, p, rho, a, sigma: rho / 1.225 };
  }

  // Basit, tekrarlanabilir gürültü (türbülans için)
  function noise1(t, seed) {
    return (
      Math.sin(t * 1.13 + seed) * 0.5 +
      Math.sin(t * 2.71 + seed * 1.7) * 0.3 +
      Math.sin(t * 5.37 + seed * 2.3) * 0.2
    );
  }

  Object.assign(GS, { V, Q, clamp, approach, wrapPi, wrap2Pi, smoothstep, DEG, KT, FT, FPM, atmosphere, noise1 });
})(typeof globalThis !== 'undefined' ? globalThis : window);
