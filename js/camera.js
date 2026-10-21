/* GökSim — kamera modları (Cesium)
 * chase: arkadan takip, cockpit: pilot gözü, orbit: serbest (fareyle döndür), tower: yerden izleyici
 */
(function (G) {
  'use strict';
  const GS = (G.GS = G.GS || {});
  const { Q, clamp, wrapPi, DEG } = GS;

  const MODES = ['chase', 'cockpit', 'orbit', 'tower'];
  const NAMES = { chase: 'Takip kamerası', cockpit: 'Kokpit', orbit: 'Serbest kamera', tower: 'Kule kamerası' };

  class CameraRig {
    constructor(viewer) {
      this.viewer = viewer;
      this.cam = viewer.camera;
      this.ctrl = viewer.scene.screenSpaceCameraController;
      this.mode = 'chase';
      this.orbitYaw = 0;
      this.orbitPitch = 0;
      this.zoom = 1;
      this.lookYaw = 0;
      this.lookPitch = 0;
      this.fovCockpit = 70 * DEG;
      this.camHdg = null;
      this.tower = null;
      this.towerZoom = 1;
      this.drag = null;
      this.mouseYoke = false;
      this.scratch = {
        pos: new Cesium.Cartesian3(),
        dir: new Cesium.Cartesian3(),
        up: new Cesium.Cartesian3(),
        hpr: new Cesium.HeadingPitchRange(),
      };
      this.setInputs(false);
      this.bindMouse();
    }

    static get MODES() { return MODES; }
    static name(m) { return NAMES[m]; }

    setInputs(on) {
      const c = this.ctrl;
      c.enableInputs = on;
      c.enableRotate = on;
      c.enableZoom = on;
      c.enableTilt = on;
      c.enableLook = on;
      c.enableTranslate = false;
    }

    setMode(m, fm) {
      if (!MODES.includes(m)) m = 'chase';
      this.cam.lookAtTransform(Cesium.Matrix4.IDENTITY);
      this.mode = m;
      this.setInputs(m === 'orbit');
      this.cam.frustum.fov = m === 'cockpit' ? this.fovCockpit : 60 * DEG;
      this.lookYaw = this.lookPitch = 0;
      if (m === 'chase') this.camHdg = null;
      if (m === 'orbit' && fm) this.initOrbit = true;
      if (m === 'tower' && fm) this.tower = null;
    }

    next(fm) {
      const i = MODES.indexOf(this.mode);
      this.setMode(MODES[(i + 1) % MODES.length], fm);
      return this.mode;
    }

    resetView() {
      this.orbitYaw = this.orbitPitch = 0;
      this.zoom = 1;
      this.lookYaw = this.lookPitch = 0;
      this.towerZoom = 1;
      this.camHdg = null;
      if (this.mode === 'orbit') this.initOrbit = true;
    }

    bindMouse() {
      const cv = this.viewer.canvas;
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('pointerdown', (e) => {
        if (this.mode === 'orbit') return;
        const allowed = this.mouseYoke ? e.button === 2 : e.button === 0 || e.button === 2;
        if (!allowed) return;
        this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
        cv.setPointerCapture(e.pointerId);
      });
      cv.addEventListener('pointermove', (e) => {
        if (!this.drag || e.pointerId !== this.drag.id) return;
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        if (this.mode === 'chase') {
          this.orbitYaw = wrapPi(this.orbitYaw + dx * 0.006);
          this.orbitPitch = clamp(this.orbitPitch + dy * 0.004, -1.2, 1.3);
        } else if (this.mode === 'cockpit') {
          this.lookYaw = clamp(this.lookYaw + dx * 0.004, -2.6, 2.6);
          this.lookPitch = clamp(this.lookPitch - dy * 0.004, -1.2, 1.2);
        }
      });
      const up = () => (this.drag = null);
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('dblclick', () => this.resetView());
      cv.addEventListener(
        'wheel',
        (e) => {
          if (this.mode === 'orbit') return;
          e.preventDefault();
          const f = Math.exp(Math.sign(e.deltaY) * 0.12);
          if (this.mode === 'chase') this.zoom = clamp(this.zoom * f, 0.35, 12);
          else if (this.mode === 'cockpit') {
            this.fovCockpit = clamp(this.fovCockpit * f, 25 * DEG, 100 * DEG);
            this.cam.frustum.fov = this.fovCockpit;
          } else if (this.mode === 'tower') this.towerZoom = clamp(this.towerZoom * f, 0.2, 5);
        },
        { passive: false }
      );
    }

    // enuM: uçağın konumundaki ENU->ECEF matrisi
    update(dt, fm, enuM, ground) {
      const cam = this.cam;
      const def = fm.def;
      const C3 = Cesium.Cartesian3;
      const M4 = Cesium.Matrix4;
      const sc = this.scratch;
      if (this.mode === 'chase') {
        const h = fm.heading;
        if (this.camHdg == null) this.camHdg = h;
        this.camHdg = this.camHdg + wrapPi(h - this.camHdg) * (1 - Math.exp(-dt * 2.2));
        const range = def.cam.dist * this.zoom;
        // hedef uçağın biraz altında: uçak ekranda gösterge panelinin üstünde kalır
        const tz = def.cam.height * 0.35 - range * 0.11;
        const target = M4.multiplyByPoint(enuM, new C3(0, 0, tz), sc.pos);
        let pitch = -0.13 - this.orbitPitch * 0.8;
        const targetAlt = fm.alt + tz;
        const lim = Math.asin(clamp((targetAlt - ground - 1.2) / range, -1, 1));
        pitch = Math.min(pitch, lim);
        sc.hpr.heading = this.camHdg + this.orbitYaw;
        sc.hpr.pitch = clamp(pitch, -1.5, 1.4);
        sc.hpr.range = range;
        cam.lookAt(target, sc.hpr);
      } else if (this.mode === 'cockpit') {
        const e = def.cam.eye;
        const ly = this.lookYaw, lp = this.lookPitch;
        const dB = [Math.sin(ly) * Math.cos(lp), Math.cos(ly) * Math.cos(lp), Math.sin(lp)];
        const uB = [-Math.sin(ly) * Math.sin(lp), -Math.cos(ly) * Math.sin(lp), Math.cos(lp)];
        const eW = Q.rotate(fm.q, e), dW = Q.rotate(fm.q, dB), uW = Q.rotate(fm.q, uB);
        const pos = M4.multiplyByPoint(enuM, new C3(eW[0], eW[1], eW[2]), sc.pos);
        const dir = M4.multiplyByPointAsVector(enuM, new C3(dW[0], dW[1], dW[2]), sc.dir);
        const upv = M4.multiplyByPointAsVector(enuM, new C3(uW[0], uW[1], uW[2]), sc.up);
        cam.setView({ destination: pos, orientation: { direction: C3.normalize(dir, dir), up: C3.normalize(upv, upv) } });
      } else if (this.mode === 'orbit') {
        if (this.initOrbit) {
          this.initOrbit = false;
          sc.hpr.heading = fm.heading + 2.4;
          sc.hpr.pitch = -0.3;
          sc.hpr.range = def.cam.dist * 2;
          cam.lookAtTransform(enuM, sc.hpr);
        } else {
          const off = C3.clone(cam.position, sc.pos);
          cam.lookAtTransform(enuM, off);
        }
      } else if (this.mode === 'tower') {
        const acPos = M4.getTranslation(enuM, new C3());
        if (!this.tower || C3.distance(this.tower, acPos) > 9000) {
          const h = fm.heading;
          const right = [Math.cos(h), -Math.sin(h)], fwd = [Math.sin(h), Math.cos(h)];
          const dz = ground - fm.alt + 22;
          const local = new C3(right[0] * 160 + fwd[0] * 260, right[1] * 160 + fwd[1] * 260, dz);
          this.tower = M4.multiplyByPoint(enuM, local, new C3());
        }
        const dir = C3.normalize(C3.subtract(acPos, this.tower, sc.dir), sc.dir);
        const upG = C3.normalize(this.tower, new C3());
        const rt = C3.normalize(C3.cross(dir, upG, new C3()), new C3());
        const upv = C3.cross(rt, dir, sc.up);
        const dist = C3.distance(acPos, this.tower);
        const fov = clamp(2 * Math.atan((def.span * 2.2 * this.towerZoom) / 2 / Math.max(dist, 1)), 2 * DEG, 65 * DEG);
        cam.frustum.fov = fov;
        cam.setView({ destination: this.tower, orientation: { direction: dir, up: upv } });
      }
    }
  }

  GS.CameraRig = CameraRig;
})(typeof globalThis !== 'undefined' ? globalThis : window);
