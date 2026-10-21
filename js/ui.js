/* GökSim — arayüz: paneller, havalimanı arama, harita, ayarlar, bildirimler */
(function (G) {
  'use strict';
  const GS = (G.GS = G.GS || {});
  const { DEG, KT, FT, FPM, clamp } = GS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fmt = (n) => Math.round(n).toLocaleString('tr-TR');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) =>
    (s || '')
      .toLocaleLowerCase('tr')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i');

  // ---------- ayarlar ----------
  const DEFAULTS = {
    imagery: 'esri',
    quality: 'mid',
    shadows: true,
    clouds: 'few',
    realTime: false,
    hud: true,
    panel: true,
    ionToken: '',
    terrain: true,
    buildings: false,
    windDir: 270,
    windKt: 0,
    turb: 0,
    control: 'keyboard',
    invertPitch: false,
    autoRudder: true,
    realistic: false,
    sensitivity: 1,
    sound: true,
    volume: 0.7,
    aircraft: 'trainer',
    spawn: null,
    seenHelp: false,
  };
  const Settings = {
    load() {
      let s = {};
      try {
        s = JSON.parse(localStorage.getItem('goksim.settings') || '{}');
      } catch (e) {
        s = {};
      }
      return Object.assign({}, DEFAULTS, s);
    },
    save(S) {
      try {
        localStorage.setItem('goksim.settings', JSON.stringify(S));
      } catch (e) {
        /* depolama kapalı olabilir */
      }
    },
  };
  GS.Settings = Settings;

  // ---------- havalimanı verisi ----------
  const AP = {
    list: [],
    index: [],
    init() {
      this.list = window.GS_AIRPORTS || [];
      this.index = this.list.map((a) => norm(`${a[0]} ${a[1]} ${a[2]} ${a[3]} ${a[10] || ''}`));
      this.byIdent = new Map(this.list.map((a) => [a[0], a]));
    },
    get(id) {
      return this.byIdent.get(id);
    },
    search(q) {
      const nq = norm(q).trim();
      if (!nq) return [];
      const toks = nq.split(/\s+/);
      const res = [];
      for (let i = 0; i < this.list.length; i++) {
        const key = this.index[i];
        if (!toks.every((t) => key.includes(t))) continue;
        const a = this.list[i];
        const id = norm(a[0]), iata = norm(a[1]);
        let sc = 0;
        if (id === nq) sc += 1000;
        if (iata && iata === nq) sc += 900;
        if (id.startsWith(nq)) sc += 300;
        if (norm(a[3]).startsWith(toks[0])) sc += 60;
        if (norm(a[2]).startsWith(toks[0])) sc += 40;
        sc += a[8] ? 50 : 0;
        res.push([sc, a]);
      }
      res.sort((x, y) => y[0] - x[0]);
      return res.slice(0, 40).map((r) => r[1]);
    },
  };
  GS.Airports = AP;

  function bearing(la1, lo1, la2, lo2) {
    const p1 = la1 * DEG, p2 = la2 * DEG, dl = (lo2 - lo1) * DEG;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
  }
  function destination(la, lo, brg, dist) {
    const R = 6371008.8, d = dist / R, p1 = la * DEG, l1 = lo * DEG;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(brg));
    const l2 = l1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 / DEG, ((l2 / DEG + 540) % 360) - 180];
  }
  // pist uçları: [{ident, lat, lon, hdg, lenM, other}]
  function runwayEnds(a) {
    const ends = [];
    for (const r of a[9]) {
      const [le, la1, lo1, he, la2, lo2, lenFt] = r;
      const lenM = lenFt * FT;
      ends.push({ ident: le, lat: la1, lon: lo1, hdg: bearing(la1, lo1, la2, lo2), lenM });
      ends.push({ ident: he, lat: la2, lon: lo2, hdg: bearing(la2, lo2, la1, lo1), lenM });
    }
    return ends.filter((e) => e.ident);
  }
  GS.geo = { bearing, destination, runwayEnds };

  const POPULAR = ['LTFM', 'LTFJ', 'LTBA', 'LTAI', 'LTBJ', 'LTAC', 'LTBS', 'LOWI', 'TNCM', 'VNLK', 'KSFO', 'EGLL', 'RJTT', 'KJFK', 'OMDB', 'LSZH'];

  class UI {
    constructor(app) {
      this.app = app;
      this.S = app.S;
      this.current = null;
      AP.init();
      this.bindToolbar();
      this.bindDrawer();
      this.renderAircraft();
      this.bindLocation();
      this.bindCamera();
      this.bindAutopilot();
      this.bindSettings();
      this.bindOverlays();
      this.hudEl = $('#hud');
      this.mapReady = false;
      // dokunmatik kontroller gösterge panelinin üstünde dursun
      const bottom = $('#bottom');
      const setH = () => document.documentElement.style.setProperty('--bottom-h', bottom.offsetHeight + 'px');
      if (window.ResizeObserver) new ResizeObserver(setH).observe(bottom);
      setH();
    }

    // ---------- bildirim ----------
    toast(msg, kind = 'info', ms = 2600) {
      const box = $('#toasts');
      const el = document.createElement('div');
      el.className = 'toast ' + kind;
      el.textContent = msg;
      box.appendChild(el);
      while (box.children.length > 4) box.firstChild.remove();
      setTimeout(() => {
        el.classList.add('out');
        setTimeout(() => el.remove(), 400);
      }, ms);
    }

    // ---------- araç çubuğu / çekmece ----------
    bindToolbar() {
      $$('#toolbar [data-open]').forEach((b) => b.addEventListener('click', () => this.togglePanel(b.dataset.open)));
      $('#tb-map').addEventListener('click', () => this.toggleMap());
      $('#tb-pause').addEventListener('click', () => this.app.togglePause());
    }
    bindDrawer() {
      $('#drawer-close').addEventListener('click', () => this.closePanel());
    }
    togglePanel(name) {
      if (this.current === name) this.closePanel();
      else this.openPanel(name);
    }
    openPanel(name) {
      const d = $('#drawer');
      $$('#drawer [data-panel]').forEach((s) => (s.hidden = s.dataset.panel !== name));
      const sec = $(`#drawer [data-panel="${name}"]`);
      $('#drawer-title').textContent = sec ? sec.dataset.title : '';
      d.hidden = false;
      this.current = name;
      $$('#toolbar [data-open]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.open === name ? 'true' : 'false'));
      if (name === 'autopilot') this.renderAP();
      if (name === 'aircraft') this.renderAircraft();
      if (name === 'location') {
        const q = $('#loc-q');
        this.renderResults(q.value);
        setTimeout(() => q.focus(), 50);
      }
    }
    closePanel() {
      $('#drawer').hidden = true;
      this.current = null;
      $$('#toolbar [data-open]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }

    // ---------- uçak seçimi ----------
    renderAircraft() {
      const box = $('#ac-list');
      box.innerHTML = '';
      for (const def of GS.AIRCRAFT) {
        const b = document.createElement('button');
        b.className = 'ac-card';
        b.setAttribute('aria-current', def.id === this.app.def.id ? 'true' : 'false');
        b.innerHTML = `<span class="ac-name">${esc(def.name)}</span><span class="ac-specs">${esc(def.specs)}</span><span class="ac-hint">${esc(def.hint)}</span>`;
        b.addEventListener('click', () => {
          this.app.selectAircraft(def.id);
          this.renderAircraft();
        });
        box.appendChild(b);
      }
    }

    // ---------- konum ----------
    bindLocation() {
      const q = $('#loc-q');
      let t = null;
      q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => this.renderResults(q.value), 120);
      });
      q.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const first = $('#loc-results .apt');
          if (first) first.click();
        }
      });
      $('#coord-go').addEventListener('click', () => {
        const lat = parseFloat($('#coord-lat').value.replace(',', '.'));
        const lon = parseFloat($('#coord-lon').value.replace(',', '.'));
        const alt = parseFloat($('#coord-alt').value) || 0;
        const hdg = parseFloat($('#coord-hdg').value) || 0;
        if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 89 || Math.abs(lon) > 180) {
          this.toast('Enlem −89…89, boylam −180…180 aralığında olmalı.', 'warn');
          return;
        }
        this.app.spawn({ lat, lon, hdgDeg: hdg, onGround: alt <= 0, altAglFt: alt, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` });
        this.closePanel();
      });
    }
    renderResults(qs) {
      const box = $('#loc-results');
      let list = AP.search(qs);
      const title = $('#loc-results-title');
      if (!qs.trim()) {
        list = POPULAR.map((id) => AP.get(id)).filter(Boolean);
        title.textContent = 'Sık seçilenler';
      } else title.textContent = list.length ? `${list.length === 40 ? '40+' : list.length} sonuç` : 'Sonuç yok. ICAO kodu (LTFM), IATA kodu (IST) ya da şehir adı deneyin.';
      box.innerHTML = '';
      for (const a of list) {
        const wrap = document.createElement('div');
        wrap.className = 'apt-wrap';
        const b = document.createElement('button');
        b.className = 'apt';
        b.innerHTML = `<span class="apt-id">${esc(a[0])}${a[1] ? ` <small>${esc(a[1])}</small>` : ''}</span><span class="apt-name">${esc(a[2])}</span><span class="apt-city">${esc([a[3], a[4]].filter(Boolean).join(', '))}</span>`;
        b.addEventListener('click', () => {
          const open = wrap.classList.toggle('open');
          if (open && !wrap.querySelector('.rwys')) wrap.appendChild(this.runwayList(a));
        });
        wrap.appendChild(b);
        box.appendChild(wrap);
      }
    }
    runwayList(a) {
      const d = document.createElement('div');
      d.className = 'rwys';
      for (const e of runwayEnds(a)) {
        const row = document.createElement('div');
        row.className = 'rwy';
        row.innerHTML = `<span class="rwy-id">Pist ${esc(e.ident)}</span><span class="rwy-len">${fmt(e.lenM)} m</span>`;
        const go = document.createElement('button');
        go.className = 'btn small primary';
        go.textContent = 'Pistte başla';
        go.addEventListener('click', () => {
          this.app.spawnRunway(a, e, false);
          this.closePanel();
        });
        const app = document.createElement('button');
        app.className = 'btn small';
        app.textContent = 'Yaklaşmada';
        app.title = '10 km uzakta, 3° süzülüş açısında başla';
        app.addEventListener('click', () => {
          this.app.spawnRunway(a, e, true);
          this.closePanel();
        });
        row.append(go, app);
        d.appendChild(row);
      }
      return d;
    }

    // ---------- kamera ----------
    bindCamera() {
      $$('[data-cam]').forEach((b) => b.addEventListener('click', () => this.app.setCamera(b.dataset.cam)));
      $('#cam-reset').addEventListener('click', () => this.app.cam.resetView());
    }
    markCamera(mode) {
      $$('[data-cam]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cam === mode ? 'true' : 'false'));
    }

    // ---------- otopilot ----------
    bindAutopilot() {
      $('#ap-toggle').addEventListener('click', () => this.app.toggleAP());
      $('#ap-sync').addEventListener('click', () => {
        const ap = this.app.ap, fm = this.app.fm;
        ap.hdgDeg = Math.round(fm.heading / DEG) % 360;
        ap.altFt = Math.max(0, Math.round(fm.alt / FT / 100) * 100);
        ap.spdKt = Math.round(fm.ias / KT);
        this.renderAP();
      });
      $$('[data-ap]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const ap = this.app.ap;
          const v = parseFloat(inp.value);
          if (!isFinite(v)) return this.renderAP();
          const k = inp.dataset.ap;
          if (k === 'hdg') ap.hdgDeg = ((Math.round(v) % 360) + 360) % 360;
          if (k === 'alt') ap.altFt = clamp(Math.round(v), 0, 60000);
          if (k === 'vs') ap.vsFpm = clamp(Math.abs(Math.round(v)), 100, 8000);
          if (k === 'spd') ap.spdKt = clamp(Math.round(v), 30, 900);
          this.renderAP();
        });
      });
      $$('[data-ap-step]').forEach((b) =>
        b.addEventListener('click', () => {
          const [k, d] = b.dataset.apStep.split(':');
          const ap = this.app.ap;
          const n = parseFloat(d);
          if (k === 'hdg') ap.hdgDeg = (((ap.hdgDeg + n) % 360) + 360) % 360;
          if (k === 'alt') ap.altFt = clamp(ap.altFt + n, 0, 60000);
          if (k === 'vs') ap.vsFpm = clamp(ap.vsFpm + n, 100, 8000);
          if (k === 'spd') ap.spdKt = clamp(ap.spdKt + n, 30, 900);
          this.renderAP();
        })
      );
    }
    renderAP() {
      const ap = this.app.ap;
      const vals = { hdg: String(Math.round(ap.hdgDeg)).padStart(3, '0'), alt: Math.round(ap.altFt), vs: Math.round(ap.vsFpm), spd: Math.round(ap.spdKt) };
      $$('[data-ap]').forEach((i) => {
        if (document.activeElement !== i) i.value = vals[i.dataset.ap];
      });
      const t = $('#ap-toggle');
      t.setAttribute('aria-pressed', ap.on ? 'true' : 'false');
      t.textContent = ap.on ? 'Otopilotu kapat' : 'Otopilotu aç';
      const glider = this.app.def.engine.type === 'winch';
      $('#ap-note').textContent = glider
        ? 'Planörde motor yok: otopilot baş ve hızı tutar, hızı burun açısıyla korur.'
        : 'Otopilot açıkken hız gazla, irtifa dikey hız sınırıyla tutulur.';
      $('#ap-alt-row').hidden = glider;
      $('#ap-vs-row').hidden = glider;
    }

    // ---------- ayarlar ----------
    bindSettings() {
      const S = this.S;
      const bind = (id, key, type, after) => {
        const el = $(id);
        if (!el) return;
        const read = () => (type === 'bool' ? el.checked : type === 'num' ? parseFloat(el.value) : el.value);
        const write = () => {
          if (type === 'bool') el.checked = !!S[key];
          else el.value = S[key];
        };
        write();
        el.addEventListener('change', () => {
          const v = read();
          if (type === 'num' && !isFinite(v)) return write();
          S[key] = v;
          Settings.save(S);
          this.app.applySetting(key);
          if (after) after();
        });
        if (type === 'num' && el.type === 'range') el.addEventListener('input', () => {
          S[key] = read();
          this.app.applySetting(key);
        });
      };
      bind('#set-imagery', 'imagery', 'str');
      bind('#set-quality', 'quality', 'str');
      bind('#set-shadows', 'shadows', 'bool');
      bind('#set-clouds', 'clouds', 'str');
      bind('#set-realtime', 'realTime', 'bool');
      bind('#set-hud', 'hud', 'bool');
      bind('#set-terrain', 'terrain', 'bool');
      bind('#set-buildings', 'buildings', 'bool');
      bind('#set-winddir', 'windDir', 'num');
      bind('#set-windkt', 'windKt', 'num');
      bind('#set-turb', 'turb', 'num');
      bind('#set-control', 'control', 'str');
      bind('#set-invert', 'invertPitch', 'bool');
      bind('#set-autorudder', 'autoRudder', 'bool');
      bind('#set-realistic', 'realistic', 'bool', () => this.renderRealism());
      this.renderRealism();
      bind('#set-sens', 'sensitivity', 'num');
      bind('#set-sound', 'sound', 'bool');
      bind('#set-volume', 'volume', 'num');
      const tok = $('#set-token');
      tok.value = S.ionToken || '';
      $('#set-token-save').addEventListener('click', () => {
        S.ionToken = tok.value.trim();
        Settings.save(S);
        this.app.applySetting('ionToken');
        this.renderTokenState();
      });
      this.renderTokenState();
    }
    renderRealism() {
      const ar = $('#set-autorudder');
      ar.disabled = !!this.S.realistic;
      ar.closest('label').title = this.S.realistic ? 'Gerçekçi modda otomatik dümen kapalıdır.' : '';
    }
    syncSetting(key) {
      const map = { control: '#set-control', hud: '#set-hud' };
      const el = map[key] && $(map[key]);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!this.S[key];
      else el.value = this.S[key];
    }
    renderTokenState() {
      const has = !!this.S.ionToken;
      $('#token-state').textContent = has
        ? 'Anahtar kayıtlı. 3D arazi ve binalar bu anahtarla yüklenir.'
        : 'Anahtar yok: dünya düz elipsoit üzerinde uydu görüntüsüyle gösterilir.';
      $('#set-terrain').disabled = !has;
      $('#set-buildings').disabled = !has;
    }

    // ---------- katmanlar ----------
    bindOverlays() {
      $('#crash-reset').addEventListener('click', () => this.app.reset());
      $('#crash-loc').addEventListener('click', () => {
        this.hideCrash();
        this.openPanel('location');
      });
      $('#pause-resume').addEventListener('click', () => this.app.togglePause());
    }
    showCrash(reason) {
      $('#crash-reason').textContent = reason;
      $('#overlay-crash').hidden = false;
    }
    hideCrash() {
      $('#overlay-crash').hidden = true;
    }
    setPause(on) {
      $('#overlay-pause').hidden = !on;
      $('#tb-pause').setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    setLoading(text) {
      const el = $('#loading');
      if (text == null) {
        el.classList.add('done');
        setTimeout(() => {
          if (el.classList.contains('done')) el.hidden = true;
        }, 500);
      } else {
        el.hidden = false;
        el.classList.remove('done');
        $('#loading-text').textContent = text;
      }
    }

    // ---------- bilgi satırı ----------
    updateHud(fm, fps) {
      const el = this.hudEl;
      if (!this.S.hud) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      const vs = fm.vs / FPM;
      const rows = [
        ['IAS', `${fmt(fm.ias / KT)} kt`],
        ['GS', `${fmt(fm.gs / KT)} kt`],
        ['İrtifa', `${fmt(fm.alt / FT)} ft`],
        ['Yerden', `${fmt(Math.max(0, fm.agl) / FT)} ft`],
        ['Dikey', `${vs >= 0 ? '+' : '−'}${fmt(Math.abs(vs))} ft/dk`],
        ['Baş', `${String(Math.round(fm.heading / DEG) % 360).padStart(3, '0')}°`],
      ];
      if (fm.def.engine.type === 'jet') rows.push(['Mach', (fm.mach || 0).toFixed(2)]);
      if (this.S.realistic && fm.def.fuel) rows.push(['Yakıt', `${fmt(fm.fuel)} kg`]);
      rows.push(['G', (fm.nz || 0).toFixed(1)]);
      rows.push(['FPS', String(Math.round(fps))]);
      el.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    }

    // ---------- harita ----------
    toggleMap(force) {
      const box = $('#mapbox');
      const show = force != null ? force : box.hidden;
      box.hidden = !show;
      if (show) {
        if (!this.mapReady) this.initMap();
        else this.map.invalidateSize();
      }
    }
    initMap() {
      if (!window.L) {
        $('#map').textContent = 'Harita kütüphanesi yüklenemedi. İnternet bağlantısını kontrol edin.';
        return;
      }
      const fm = this.app.fm;
      const lat = fm.lat / DEG, lon = fm.lon / DEG;
      const map = L.map('map', { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([lat, lon], 11);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıcıları',
      }).addTo(map);
      this.planeIcon = L.divIcon({
        className: 'plane-icon',
        html: '<svg viewBox="-12 -12 24 24" width="26" height="26"><path d="M0,-10 L2,-3 L9,1 L9,3 L2,1.5 L1.5,7 L4,9 L4,10 L-4,10 L-4,9 L-1.5,7 L-2,1.5 L-9,3 L-9,1 L-2,-3 Z"/></svg>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      this.marker = L.marker([lat, lon], { icon: this.planeIcon, interactive: false, keyboard: false }).addTo(map);
      this.track = L.polyline([], { color: '#d24ca9', weight: 2, opacity: 0.85 }).addTo(map);
      this.aptLayer = L.layerGroup().addTo(map);
      map.on('contextmenu', (e) => this.teleportPopup(e.latlng));
      map.on('moveend', () => this.drawAirports());
      map.on('dragstart', () => {
        $('#map-follow').checked = false;
      });
      $('#map-center-go').addEventListener('click', () => this.teleportPopup(map.getCenter()));
      $('#map-close').addEventListener('click', () => this.toggleMap(false));
      this.map = map;
      this.mapReady = true;
      this.drawAirports();
    }
    teleportPopup(ll) {
      const div = document.createElement('div');
      div.className = 'tp';
      div.innerHTML = `<p>${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}</p>`;
      const b = document.createElement('button');
      b.className = 'btn small primary';
      b.textContent = 'Buraya ışınlan';
      b.addEventListener('click', () => {
        this.map.closePopup();
        this.app.teleport(ll.lat, ((ll.lng + 540) % 360) - 180);
      });
      div.appendChild(b);
      L.popup().setLatLng(ll).setContent(div).openOn(this.map);
    }
    drawAirports() {
      if (!this.map) return;
      this.aptLayer.clearLayers();
      const z = this.map.getZoom();
      if (z < 7) return;
      const b = this.map.getBounds();
      let n = 0;
      for (const a of AP.list) {
        if (!b.contains([a[5], a[6]])) continue;
        if (z < 9 && !a[8]) continue;
        if (++n > 160) break;
        const m = L.circleMarker([a[5], a[6]], { radius: a[8] ? 6 : 4, color: '#1f6fb2', weight: 2, fillColor: '#fff', fillOpacity: 0.9 });
        m.bindTooltip(`${a[0]} ${a[2]}`, { direction: 'top' });
        m.on('click', () => {
          const div = document.createElement('div');
          div.className = 'tp';
          div.innerHTML = `<p><b>${esc(a[0])}</b> ${esc(a[2])}</p>`;
          div.appendChild(this.runwayList(a));
          L.popup({ maxWidth: 300 }).setLatLng([a[5], a[6]]).setContent(div).openOn(this.map);
        });
        this.aptLayer.addLayer(m);
      }
    }
    updateMap(fm) {
      if (!this.mapReady || $('#mapbox').hidden) return;
      const ll = [fm.lat / DEG, fm.lon / DEG];
      this.marker.setLatLng(ll);
      const el = this.marker.getElement();
      if (el) {
        const svg = el.querySelector('svg');
        if (svg) svg.style.transform = `rotate(${fm.heading / DEG}deg)`;
      }
      const pts = this.track.getLatLngs();
      const last = pts[pts.length - 1];
      if (!last || Math.abs(last.lat - ll[0]) + Math.abs(last.lng - ll[1]) > 0.0004) {
        this.track.addLatLng(ll);
        if (pts.length > 3000) this.track.setLatLngs(pts.slice(-2500));
      }
      if ($('#map-follow').checked) this.map.panTo(ll, { animate: false });
    }
    clearTrack() {
      if (this.track) this.track.setLatLngs([]);
    }
  }

  GS.UI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : window);
