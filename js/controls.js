/* GökSim — kontroller: klavye, fare (yoke), gamepad, dokunmatik */
(function (G) {
  'use strict';
  const GS = (G.GS = G.GS || {});
  const { clamp, approach } = GS;

  const TYPING = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };

  class Controls {
    constructor(settings, onAction) {
      this.S = settings;
      this.onAction = onAction;
      this.keys = new Set();
      this.logical = new Map();
      this.kb = { e: 0, a: 0, r: 0 };
      this.mouse = { x: 0, y: 0, active: false };
      this.pad = null;
      this.padPrev = [];
      this.touch = { e: 0, a: 0, active: false };
      this.reset();
      this.bind();
      this.buildTouch();
    }

    reset() {
      this.throttle = 0;
      this.trim = 0;
      this.flapIndex = 0;
      this.gearDown = true;
      this.brakes = 0;
      this.parkingBrake = false;
      this.spoilers = false;
      this.engineOn = true;
    }

    bind() {
      window.addEventListener('keydown', (e) => {
        if (TYPING(e)) return;
        const c = e.code;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Home', 'End'].includes(c)) e.preventDefault();
        if (c === 'F1') e.preventDefault();
        this.onAction('any');
        this.keys.add(c);
        const lg = e.key === '+' || e.key === '=' ? 'PLUS' : e.key === '-' ? 'MINUS' : null;
        if (lg) {
          this.keys.add(lg);
          this.logical.set(c, lg);
        }
        if (e.repeat) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const sh = e.shiftKey;
        switch (c) {
          case 'KeyG': this.onAction('gear'); break;
          case 'KeyF': this.onAction(sh ? 'flapsUp' : 'flapsDown'); break;
          case 'KeyK': this.onAction('spoilers'); break;
          case 'KeyE': this.onAction('engine'); break;
          case 'KeyA': this.onAction('autopilot'); break;
          case 'KeyC': this.onAction('camera'); break;
          case 'Digit1': this.onAction('cameraSet', 'chase'); break;
          case 'Digit2': this.onAction('cameraSet', 'cockpit'); break;
          case 'Digit3': this.onAction('cameraSet', 'orbit'); break;
          case 'Digit4': this.onAction('cameraSet', 'tower'); break;
          case 'KeyM': this.onAction('map'); break;
          case 'KeyH': this.onAction('panel'); break;
          case 'KeyI': this.onAction('hud'); break;
          case 'KeyP': case 'Pause': this.onAction('pause'); break;
          case 'KeyR': this.onAction('reset'); break;
          case 'KeyY': this.onAction('mouseYoke'); break;
          case 'F1': this.onAction('help'); break;
          case 'Escape': this.onAction('escape'); break;
          case 'KeyB': if (sh) this.onAction('parkingBrake'); break;
          case 'KeyT': this.trimStep(sh ? -1 : 1); break;
        }
        if (e.key === '?') this.onAction('help');
      });
      window.addEventListener('keyup', (e) => {
        this.keys.delete(e.code);
        const lg = this.logical.get(e.code);
        if (lg) {
          this.keys.delete(lg);
          this.logical.delete(e.code);
        }
      });
      window.addEventListener('blur', () => {
        this.keys.clear();
        this.logical.clear();
      });
      window.addEventListener('mousemove', (e) => {
        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
      });
      window.addEventListener('gamepadconnected', (e) => this.onAction('gamepad', e.gamepad.id));
    }

    trimStep(dir) {
      this.trim = clamp(this.trim + dir * 0.04, -1, 1);
    }

    key(...codes) {
      return codes.some((c) => this.keys.has(c));
    }

    buildTouch() {
      const root = document.getElementById('touch');
      if (!root) return;
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      if (!isTouch) return;
      root.hidden = false;
      const stick = root.querySelector('.stick');
      const knob = root.querySelector('.knob');
      const thr = root.querySelector('.thr');
      const thrKnob = root.querySelector('.thr-knob');
      let sid = null;
      const moveStick = (e) => {
        const r = stick.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        this.touch.a = dx;
        this.touch.e = dy * (this.S.invertPitch ? -1 : 1);
        knob.style.transform = `translate(${dx * r.width * 0.35}px, ${dy * r.height * 0.35}px)`;
      };
      stick.addEventListener('pointerdown', (e) => {
        sid = e.pointerId;
        stick.setPointerCapture(sid);
        this.touch.active = true;
        moveStick(e);
        this.onAction('any');
      });
      stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) moveStick(e); });
      const end = () => {
        sid = null;
        this.touch.active = false;
        this.touch.a = this.touch.e = 0;
        knob.style.transform = '';
      };
      stick.addEventListener('pointerup', end);
      stick.addEventListener('pointercancel', end);
      let tid = null;
      const moveThr = (e) => {
        const r = thr.getBoundingClientRect();
        this.throttle = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      };
      thr.addEventListener('pointerdown', (e) => { tid = e.pointerId; thr.setPointerCapture(tid); moveThr(e); this.onAction('any'); });
      thr.addEventListener('pointermove', (e) => { if (e.pointerId === tid) moveThr(e); });
      thr.addEventListener('pointerup', () => (tid = null));
      this.thrKnob = thrKnob;
      root.querySelectorAll('[data-act]').forEach((b) =>
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const act = b.dataset.act;
          if (act === 'brakes') {
            this.touchBrake = true;
            const up = () => { this.touchBrake = false; window.removeEventListener('pointerup', up); };
            window.addEventListener('pointerup', up);
          } else this.onAction(act);
        })
      );
    }

    readPad(dt) {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp = null;
      for (const p of pads) if (p && p.connected) { gp = p; break; }
      if (!gp) return null;
      const dz = (v) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
      const ax = gp.axes;
      const btn = (i) => (gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0);
      const pressed = (i) => btn(i) > 0.5 && !(this.padPrev[i] > 0.5);
      const out = { a: dz(ax[0] || 0), e: dz(ax[1] || 0) * (this.S.invertPitch ? -1 : 1), r: 0 };
      if (gp.mapping === 'standard') {
        out.r = dz(ax[2] || 0);
        const thrRate = btn(7) - btn(6) - dz(ax[3] || 0) * 0.6;
        this.throttle = clamp(this.throttle + thrRate * 0.6 * dt, 0, 1);
        if (btn(0) > 0.5) out.brake = 1;
        if (pressed(1)) this.onAction('flapsDown');
        if (pressed(2)) this.onAction('flapsUp');
        if (pressed(3)) this.onAction('gear');
        if (pressed(4)) this.onAction('camera');
        if (pressed(5)) this.onAction('autopilot');
        if (pressed(9)) this.onAction('pause');
        if (pressed(8)) this.onAction('map');
        if (btn(12) > 0.5) this.trim = clamp(this.trim - 0.25 * dt, -1, 1);
        if (btn(13) > 0.5) this.trim = clamp(this.trim + 0.25 * dt, -1, 1);
      } else {
        // uçuş çubuğu (HOTAS): eksen 2 gaz, eksen 5 veya 3 dümen
        if (ax.length > 2 && Math.abs(ax[2]) > 0.001) this.throttle = clamp((1 - ax[2]) / 2, 0, 1);
        out.r = dz(ax.length > 5 ? ax[5] : ax[3] || 0);
        if (btn(0) > 0.5) out.brake = 1;
        if (pressed(1)) this.onAction('gear');
        if (pressed(2)) this.onAction('flapsDown');
        if (pressed(3)) this.onAction('flapsUp');
      }
      this.padPrev = gp.buttons.map((b) => b.value || (b.pressed ? 1 : 0));
      return out;
    }

    update(dt) {
      const S = this.S;
      const sens = S.sensitivity || 1;
      const k = (a, b) => (this.key(...a) ? 1 : 0) - (this.key(...b) ? 1 : 0);
      let pe = k(['ArrowDown'], ['ArrowUp']);
      if (S.invertPitch) pe = -pe;
      const pa = k(['ArrowRight'], ['ArrowLeft']);
      const pr = k(['KeyX', 'Period'], ['KeyZ', 'Comma']);
      this.kb.e = pe ? approach(this.kb.e, pe, 1.6 * sens * dt) : approach(this.kb.e, 0, 2.5 * dt);
      this.kb.a = pa ? approach(this.kb.a, pa, 2.2 * sens * dt) : approach(this.kb.a, 0, 3 * dt);
      this.kb.r = pr ? approach(this.kb.r, pr, 2.5 * dt) : approach(this.kb.r, 0, 3 * dt);
      const thrUp = this.key('PageUp', 'PLUS', 'NumpadAdd');
      const thrDn = this.key('PageDown', 'MINUS', 'NumpadSubtract');
      if (thrUp) this.throttle = clamp(this.throttle + 0.45 * dt, 0, 1);
      if (thrDn) this.throttle = clamp(this.throttle - 0.45 * dt, 0, 1);
      if (this.key('Home')) this.trim = clamp(this.trim - 0.3 * dt, -1, 1);
      if (this.key('End')) this.trim = clamp(this.trim + 0.3 * dt, -1, 1);
      this.brakes = this.key('KeyB', 'Space') || this.touchBrake ? 1 : 0;

      let e = this.kb.e, a = this.kb.a, r = this.kb.r;
      if (S.control === 'mouse') {
        const dz = (v) => (Math.abs(v) < 0.04 ? 0 : v);
        e += clamp(dz(this.mouse.y) * 1.3 * sens, -1, 1) * (S.invertPitch ? -1 : 1);
        a += clamp(dz(this.mouse.x) * 1.3 * sens, -1, 1);
      }
      const pad = this.readPad(dt);
      if (pad) {
        e += pad.e;
        a += pad.a;
        r += pad.r;
        if (pad.brake) this.brakes = 1;
      }
      if (this.touch.active) {
        e += this.touch.e;
        a += this.touch.a;
      }
      if (this.thrKnob) this.thrKnob.style.bottom = `calc(${this.throttle * 100}% - 14px)`;
      this.elevator = clamp(e, -1, 1);
      this.aileron = clamp(a, -1, 1);
      this.rudder = clamp(r, -1, 1);
    }

    input(def) {
      return {
        elevator: this.elevator || 0,
        aileron: this.aileron || 0,
        rudder: this.rudder || 0,
        throttle: this.throttle,
        trim: this.trim,
        flaps: def.flaps ? def.flaps.values[Math.min(this.flapIndex, def.flaps.values.length - 1)] : 0,
        gearDown: this.gearDown,
        brakes: this.brakes,
        parkingBrake: this.parkingBrake,
        spoilers: this.spoilers,
        engineOn: this.engineOn,
      };
    }
  }

  GS.Controls = Controls;
})(typeof globalThis !== 'undefined' ? globalThis : window);
