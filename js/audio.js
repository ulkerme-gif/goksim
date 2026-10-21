/* GökSim — sentezlenmiş sesler (WebAudio, dosya gerektirmez) */
(function (G) {
  'use strict';
  const GS = (G.GS = G.GS || {});
  const { clamp } = GS;

  class Sound {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.volume = 0.7;
      this.ready = false;
    }

    // Tarayıcılar sesi ancak kullanıcı etkileşiminden sonra başlatır
    unlock() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build();
    }

    build() {
      const c = this.ctx;
      const len = c.sampleRate * 2;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      let b = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b = 0.97 * b + 0.03 * w;
        d[i] = w * 0.6 + b * 2.5;
      }
      this.noiseBuf = buf;
      const noise = () => {
        const s = c.createBufferSource();
        s.buffer = buf;
        s.loop = true;
        s.start(0, Math.random() * 1.5);
        return s;
      };
      const gain = (v, dest) => {
        const g = c.createGain();
        g.gain.value = v;
        g.connect(dest);
        return g;
      };
      const filt = (type, f, q, dest) => {
        const n = c.createBiquadFilter();
        n.type = type;
        n.frequency.value = f;
        n.Q.value = q;
        n.connect(dest);
        return n;
      };
      this.master = gain(this.enabled ? this.volume : 0, c.destination);
      // pistonlu motor
      this.engGain = gain(0, this.master);
      this.engFilt = filt('lowpass', 600, 1.2, this.engGain);
      this.osc1 = c.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc1.connect(this.engFilt);
      this.osc1.start();
      this.osc2 = c.createOscillator();
      this.osc2.type = 'square';
      const o2g = gain(0.35, this.engFilt);
      this.osc2.connect(o2g);
      this.osc2.start();
      const engNoise = noise();
      this.engNoiseFilt = filt('bandpass', 300, 0.8, gain(0.5, this.engGain));
      engNoise.connect(this.engNoiseFilt);
      // jet
      this.jetGain = gain(0, this.master);
      this.jetFilt = filt('bandpass', 700, 0.6, this.jetGain);
      noise().connect(this.jetFilt);
      this.whineGain = gain(0, this.master);
      this.whine = c.createOscillator();
      this.whine.type = 'sine';
      this.whine.connect(this.whineGain);
      this.whine.start();
      this.abGain = gain(0, this.master);
      noise().connect(filt('lowpass', 260, 0.7, this.abGain));
      // rüzgâr
      this.windGain = gain(0, this.master);
      this.windFilt = filt('lowpass', 500, 0.5, this.windGain);
      noise().connect(this.windFilt);
      // yerde tekerlek gürültüsü
      this.rumbleGain = gain(0, this.master);
      noise().connect(filt('lowpass', 160, 0.9, this.rumbleGain));
      // stall uyarısı
      this.stallGain = gain(0, this.master);
      const so = c.createOscillator();
      so.type = 'square';
      so.frequency.value = 880;
      so.connect(filt('lowpass', 1800, 0.7, this.stallGain));
      so.start();
      this.ready = true;
    }

    setEnabled(on, vol) {
      this.enabled = on;
      if (vol != null) this.volume = vol;
      if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
    }

    set(param, v, tc = 0.08) {
      param.setTargetAtTime(v, this.ctx.currentTime, tc);
    }

    update(fm, paused, cockpit) {
      if (!this.ready) return;
      const d = fm.def;
      const t = this.ctx.currentTime;
      const live = !paused && !fm.crashed;
      const n = fm.n || 0;
      const inside = cockpit ? 1 : 0.75;
      if (d.engine.type === 'prop' && live && (fm.engineOn || fm.engState === 'starting')) {
        const rpm = fm.rpm;
        const f = (rpm / 60) * 2;
        this.set(this.osc1.frequency, f);
        this.set(this.osc2.frequency, f * 0.5);
        this.set(this.engFilt.frequency, 300 + rpm * 0.5);
        this.set(this.engNoiseFilt.frequency, 120 + rpm * 0.15);
        this.set(this.engGain.gain, (0.1 + 0.22 * n) * inside);
      } else this.set(this.engGain.gain, 0, 0.3);
      if (d.engine.type === 'jet' && live && fm.engineOn) {
        this.set(this.jetFilt.frequency, 350 + n * 1600);
        this.set(this.jetGain.gain, (0.08 + 0.4 * n) * inside);
        this.set(this.whine.frequency, 900 + n * 3200);
        this.set(this.whineGain.gain, (0.012 + 0.03 * n) * inside);
        this.set(this.abGain.gain, fm.afterburner ? 0.55 : 0, 0.2);
      } else {
        this.set(this.jetGain.gain, 0, 0.4);
        this.set(this.whineGain.gain, 0, 0.4);
        this.set(this.abGain.gain, 0, 0.2);
      }
      const v = live ? fm.tas : 0;
      this.set(this.windGain.gain, clamp((v / 140) * (v / 140) * 0.45, 0, 0.5) + (fm.spoiler || 0) * clamp(v / 80, 0, 0.25));
      this.set(this.windFilt.frequency, 250 + v * 9);
      this.set(this.rumbleGain.gain, live && fm.wheelsDown > 0 ? clamp(fm.gs / 35, 0, 1) * 0.5 : 0, 0.05);
      const stall = live && fm.stall ? (Math.sin(t * 18) > 0 ? 0.12 : 0.04) : 0;
      this.set(this.stallGain.gain, stall, 0.02);
    }

    burst(vol, dur, freq) {
      if (!this.ready) return;
      const c = this.ctx;
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      const g = c.createGain();
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      s.connect(f);
      f.connect(g);
      g.connect(this.master);
      s.start(0, Math.random());
      s.stop(c.currentTime + dur + 0.05);
    }

    touchdown(vs) {
      this.burst(clamp(vs / 3, 0.15, 1.2), 0.35, 220);
    }
    crash() {
      this.burst(2, 1.8, 900);
    }
    clunk() {
      this.burst(0.35, 0.18, 400);
    }
    beep(f = 1200, dur = 0.12) {
      if (!this.ready) return;
      const c = this.ctx;
      const o = c.createOscillator();
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.12, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      o.connect(g);
      g.connect(this.master);
      o.start();
      o.stop(c.currentTime + dur);
    }
  }

  GS.Sound = Sound;
})(typeof globalThis !== 'undefined' ? globalThis : window);
