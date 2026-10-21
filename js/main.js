/* GökSim — ana uygulama */
(function () {
  'use strict';
  const GS = window.GS;
  const { DEG, KT, FT, FPM, clamp } = GS;
  const $ = (s) => document.querySelector(s);

  const DEFAULT_SPAWN = { icao: 'LTFM', rwy: '35L', approach: false };

  class App {
    constructor() {
      this.S = GS.Settings.load();
      this.def = GS.getAircraft(this.S.aircraft);
      this.env = { wind: [0, 0, 0], turbulence: 0 };
      this.fm = new GS.FlightModel(this.def, this.env);
      this.fm.reset({ lat: 41.26 * DEG, lon: 28.73 * DEG, heading: 0, onGround: true, ground: 0 });
      this.fm.setRealism(this.S.realistic);
      this.ap = new GS.Autopilot();
      this.ap.setDefaults(this.def);
      this.paused = false;
      this.loading = true;
      this.groundEst = 0;
      this.terrainOn = false;
      this.spawnToken = 0;
      this.fps = 60;
      this.timers = { hud: 0, map: 0, clouds: 0, scrape: 0 };
      this.propAng = 0;
      this.sound = new GS.Sound();
      this.sound.setEnabled(this.S.sound, this.S.volume);
      this.ui = new GS.UI(this);
      this.controls = new GS.Controls(this.S, (a, arg) => this.action(a, arg));
      this.instruments = new GS.Instruments($('#panel'));
      this.instruments.realistic = !!this.S.realistic;
      this.applyPanel();
      document.body.classList.toggle('mouse-yoke', this.S.control === 'mouse');
    }

    async start() {
      const ui = this.ui;
      ui.setLoading('3D dünya hazırlanıyor…');
      if (!window.Cesium) {
        ui.setLoading('Cesium kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.');
        return;
      }
      try {
        this.initViewer();
      } catch (e) {
        console.error(e);
        ui.setLoading('3D görünüm başlatılamadı. Tarayıcınız WebGL desteklemiyor olabilir. Ayrıntı: ' + e.message);
        return;
      }
      this.cam = new GS.CameraRig(this.viewer);
      this.cam.mouseYoke = this.S.control === 'mouse';
      ui.markCamera('chase');
      this.applyQuality();
      await this.applyImagery();
      await this.applyTerrain(false);
      this.viewer.scene.preUpdate.addEventListener(() => this.frame());
      await this.loadModel();
      await this.restoreSpawn();
      if (!this.S.seenHelp) {
        ui.openPanel('help');
        this.S.seenHelp = true;
        GS.Settings.save(this.S);
      }
    }

    // ---------- Cesium ----------
    initViewer() {
      const S = this.S;
      const v = new Cesium.Viewer('cesium', {
        baseLayer: false,
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        scene3DOnly: true,
        shadows: !!S.shadows,
        terrainShadows: Cesium.ShadowMode.RECEIVE_ONLY,
        creditContainer: $('#credits'),
        msaaSamples: 4,
        requestRenderMode: false,
        contextOptions: { webgl: { powerPreference: 'high-performance' } },
      });
      this.viewer = v;
      const sc = v.scene;
      sc.globe.depthTestAgainstTerrain = true;
      sc.globe.showGroundAtmosphere = true;
      sc.globe.baseColor = Cesium.Color.fromCssColorString('#2d4a63');
      sc.globe.tileCacheSize = 400;
      sc.fog.enabled = true;
      sc.skyAtmosphere.show = true;
      sc.highDynamicRange = false;
      sc.screenSpaceCameraController.enableCollisionDetection = true;
      sc.screenSpaceCameraController.minimumZoomDistance = 2;
      v.shadowMap.maximumDistance = 900;
      v.shadowMap.size = 2048;
      v.shadowMap.softShadows = false;
      v.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      v.clock.shouldAnimate = false;
      this.enuM = new Cesium.Matrix4();
      this.rotM = new Cesium.Matrix4();
      this.posC = new Cesium.Cartesian3();
      this.carto = new Cesium.Cartographic();
      v.scene.renderError.addEventListener((scene, err) => {
        console.error(err);
        this.ui.toast('Grafik hatası oluştu. Sayfayı yenileyin ya da grafik kalitesini düşürün.', 'warn', 6000);
      });
    }

    async applyImagery() {
      const v = this.viewer;
      const kind = this.S.imagery;
      const layers = v.imageryLayers;
      layers.removeAll();
      const esriTiles = () =>
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 18,
          credit: new Cesium.Credit('Uydu görüntüsü: Esri, Maxar, Earthstar Geographics'),
        });
      if (kind === 'osm') {
        layers.addImageryProvider(
          new Cesium.UrlTemplateImageryProvider({
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            maximumLevel: 19,
            credit: new Cesium.Credit('© OpenStreetMap katkıcıları'),
          })
        );
        return;
      }
      let prov = null;
      try {
        prov = await Cesium.ArcGisMapServerImageryProvider.fromUrl('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer', {
          enablePickFeatures: false,
        });
      } catch (e) {
        prov = esriTiles();
      }
      if (this.S.imagery !== kind) return;
      layers.removeAll();
      layers.addImageryProvider(prov);
      if (kind === 'esri-labels') {
        layers.addImageryProvider(
          new Cesium.UrlTemplateImageryProvider({
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            maximumLevel: 18,
            credit: new Cesium.Credit('Etiketler: Esri'),
          })
        );
      }
    }

    async applyTerrain(respawn = true) {
      const S = this.S, v = this.viewer, ui = this.ui;
      if (S.ionToken) Cesium.Ion.defaultAccessToken = S.ionToken;
      const want = !!(S.ionToken && S.terrain);
      let changed = false;
      if (want && !this.terrainOn) {
        try {
          v.terrainProvider = await Cesium.createWorldTerrainAsync();
          this.terrainOn = true;
          changed = true;
        } catch (e) {
          console.warn(e);
          ui.toast('3D arazi yüklenemedi. Cesium ion anahtarını kontrol edin.', 'warn', 5000);
        }
      } else if (!want && this.terrainOn) {
        v.terrainProvider = new Cesium.EllipsoidTerrainProvider();
        this.terrainOn = false;
        changed = true;
      }
      const wantB = !!(S.ionToken && S.buildings);
      if (wantB && !this.buildings) {
        try {
          this.buildings = await Cesium.createOsmBuildingsAsync();
          v.scene.primitives.add(this.buildings);
        } catch (e) {
          console.warn(e);
          ui.toast('3D binalar yüklenemedi. Cesium ion anahtarını kontrol edin.', 'warn', 5000);
        }
      } else if (!wantB && this.buildings) {
        v.scene.primitives.remove(this.buildings);
        this.buildings = null;
      }
      if (changed && respawn) this.respawnHere();
    }

    applyQuality() {
      const v = this.viewer;
      if (!v) return;
      const q = this.S.quality;
      v.resolutionScale = q === 'low' ? 0.7 : q === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      v.scene.globe.maximumScreenSpaceError = q === 'low' ? 3 : q === 'high' ? 1.5 : 2;
      v.scene.msaaSamples = q === 'low' ? 1 : 4;
      v.scene.postProcessStages.fxaa.enabled = q !== 'low';
    }

    applyPanel() {
      $('#bottom').classList.toggle('no-panel', !this.S.panel);
    }

    setDaytime(lonDeg) {
      const v = this.viewer;
      if (!v) return;
      if (this.S.realTime) {
        v.clock.currentTime = Cesium.JulianDate.now();
        v.clock.shouldAnimate = true;
        v.scene.globe.enableLighting = true;
        return;
      }
      v.clock.shouldAnimate = false;
      v.scene.globe.enableLighting = false;
      const d = new Date();
      const utcH = (((10.5 - lonDeg / 15) % 24) + 24) % 24;
      const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + utcH * 3600e3;
      v.clock.currentTime = Cesium.JulianDate.fromDate(new Date(t));
    }

    // ---------- model ----------
    async loadModel() {
      const v = this.viewer;
      const token = (this.modelToken = (this.modelToken || 0) + 1);
      if (this.model) {
        v.scene.primitives.remove(this.model);
        this.model = null;
      }
      this.nodes = null;
      const res = GS.buildModel(this.def);
      let model;
      try {
        model = await Cesium.Model.fromGltfAsync({
          gltf: res.glb.slice(),
          upAxis: Cesium.Axis.Y,
          forwardAxis: Cesium.Axis.X,
          shadows: this.S.shadows ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED,
          minimumPixelSize: 0,
        });
      } catch (e) {
        console.error(e);
        this.ui.toast('Uçak modeli yüklenemedi: ' + e.message, 'warn', 6000);
        return;
      }
      if (token !== this.modelToken) {
        model.destroy();
        return;
      }
      this.placeModel(model);
      v.scene.primitives.add(model);
      this.model = model;
      model.readyEvent.addEventListener(() => {
        if (token !== this.modelToken) return;
        const nodes = {};
        for (const name of Object.keys(res.nodes)) {
          const n = model.getNode(name);
          if (n) nodes[name] = { node: n, pivotG: res.nodes[name].pivotG, shown: true };
        }
        this.nodes = nodes;
      });
    }

    placeModel(model = this.model) {
      const fm = this.fm;
      Cesium.Cartesian3.fromRadians(fm.lon, fm.lat, fm.alt, Cesium.Ellipsoid.WGS84, this.posC);
      Cesium.Transforms.eastNorthUpToFixedFrame(this.posC, Cesium.Ellipsoid.WGS84, this.enuM);
      if (!model) return;
      const m = GS.Q.toMat3(fm.q);
      const r = this.rotM;
      r[0] = m[0][0]; r[1] = m[1][0]; r[2] = m[2][0]; r[3] = 0;
      r[4] = m[0][1]; r[5] = m[1][1]; r[6] = m[2][1]; r[7] = 0;
      r[8] = m[0][2]; r[9] = m[1][2]; r[10] = m[2][2]; r[11] = 0;
      r[12] = 0; r[13] = 0; r[14] = 0; r[15] = 1;
      Cesium.Matrix4.multiply(this.enuM, r, model.modelMatrix);
    }

    animate(dt) {
      const N = this.nodes;
      if (!N) return;
      const fm = this.fm, def = this.def;
      const C3 = Cesium.Cartesian3, CQ = Cesium.Quaternion, M4 = Cesium.Matrix4;
      if (!this._ax) {
        this._ax = { x: new C3(1, 0, 0), z: new C3(0, 1, 0), y: new C3(0, 0, -1) };
        this._t = new C3();
        this._q = new CQ();
        this._s = new C3(1, 1, 1);
        this._m = new M4();
      }
      const set = (name, axis, ang, upOff = 0) => {
        const n = N[name];
        if (!n) return;
        const p = n.pivotG;
        this._t.x = p[0];
        this._t.y = p[1] + upOff;
        this._t.z = p[2];
        CQ.fromAxisAngle(this._ax[axis], ang, this._q);
        n.node.matrix = M4.fromTranslationQuaternionRotationScale(this._t, this._q, this._s, this._m);
      };
      const show = (name, on) => {
        const n = N[name];
        if (n && n.shown !== on) {
          n.node.show = on;
          n.shown = on;
        }
      };
      set('elevator', 'x', -(fm.elev + fm.trim * def.ctrl.trim * 0.5) * 0.32);
      set('rudder', 'z', fm.rud * 0.4);
      set('aileronR', 'x', -fm.ail * 0.35);
      set('aileronL', 'x', fm.ail * 0.35);
      set('flapR', 'x', fm.flaps * 0.62);
      set('flapL', 'x', fm.flaps * 0.62);
      const sp = def.engine.type === 'winch' ? 1.45 : 0.85;
      set('spoilerR', 'x', -fm.spoiler * sp);
      set('spoilerL', 'x', -fm.spoiler * sp);
      if (N.prop) {
        const rps = fm.engineOn ? fm.rpm / 60 : fm.tas * 0.12;
        this.propAng = (this.propAng + Math.min(rps, 9.3) * Math.PI * 2 * dt) % (Math.PI * 2);
        set('prop', 'y', this.propAng);
      }
      const cockpit = this.cam && this.cam.mode === 'cockpit';
      show('fuselage', !cockpit);
      show('prop', !cockpit);
      show('flame', !!fm.afterburner);
      const gp = def.gear.points;
      for (let i = 0; i < gp.length; i++) {
        const name = 'gear' + i;
        if (!N[name]) continue;
        const g = gp[i];
        const retr = def.gear.retractable ? (1 - fm.gearPos) * Math.abs(g.pos[2]) * 0.55 : 0;
        const steer = g.steer ? -fm.gearSteer * (g.pos[1] >= 0 ? 1 : -1) : 0;
        set(name, 'z', steer, (fm.gearComp[i] || 0) + retr);
        show(name, !def.gear.retractable || fm.gearPos > 0.04);
      }
    }

    // ---------- konum ----------
    async restoreSpawn() {
      const sp = this.S.spawn || DEFAULT_SPAWN;
      if (sp.icao) {
        const a = GS.Airports.get(sp.icao);
        const end = a && GS.geo.runwayEnds(a).find((e) => e.ident === sp.rwy);
        if (a && end) return this.spawnRunway(a, end, !!sp.approach);
      } else if (isFinite(sp.lat)) return this.spawn(sp);
      const a = GS.Airports.get(DEFAULT_SPAWN.icao);
      const end = GS.geo.runwayEnds(a).find((e) => e.ident === DEFAULT_SPAWN.rwy) || GS.geo.runwayEnds(a)[0];
      return this.spawnRunway(a, end, false);
    }

    spawnRunway(a, end, approach) {
      const def = this.def;
      if (!approach) {
        const into = 20 + Math.max(...def.contacts.map((c) => -c.pos[1]));
        const [la, lo] = GS.geo.destination(end.lat, end.lon, end.hdg, into);
        return this.spawn({ lat: la, lon: lo, hdgDeg: end.hdg / DEG, onGround: true, label: `${a[0]}, pist ${end.ident}`, icao: a[0], rwy: end.ident, approach: false });
      }
      const dist = def.engine.type === 'winch' ? 3500 : def.id === 'airliner' ? 12000 : def.id === 'fighter' ? 11000 : 7000;
      const [la, lo] = GS.geo.destination(end.lat, end.lon, end.hdg + Math.PI, dist);
      const aglFt = (dist * Math.tan(3 * DEG)) / FT + 50;
      return this.spawn({
        lat: la,
        lon: lo,
        hdgDeg: end.hdg / DEG,
        onGround: false,
        altAglFt: aglFt,
        refLat: end.lat,
        refLon: end.lon,
        speedKt: def.speeds.approach,
        gearDown: true,
        flapIndex: def.flaps ? def.flaps.ldg : 0,
        gamma: -3 * DEG,
        label: `${a[0]}, pist ${end.ident} yaklaşması`,
        icao: a[0],
        rwy: end.ident,
        approach: true,
      });
    }

    async sampleGround(pts) {
      if (!this.terrainOn) return pts.map(() => 0);
      try {
        const cs = pts.map(([la, lo]) => Cesium.Cartographic.fromDegrees(lo, la));
        const out = await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, cs);
        return out.map((c) => (isFinite(c.height) ? c.height : 0));
      } catch (e) {
        return pts.map(() => 0);
      }
    }

    async spawn(o) {
      const token = ++this.spawnToken;
      const fm = this.fm, def = this.def, c = this.controls, ui = this.ui;
      this.loading = true;
      ui.setLoading('Konum yükleniyor' + (o.label ? ': ' + o.label : '…'));
      ui.hideCrash();
      this.ap.disengage();
      ui.renderAP();
      const pts = [[o.lat, o.lon]];
      if (o.refLat != null) pts.push([o.refLat, o.refLon]);
      const gr = await this.sampleGround(pts);
      if (token !== this.spawnToken) return;
      const ground = gr[0];
      const refGround = gr.length > 1 ? gr[1] : ground;
      this.groundEst = ground;
      c.reset();
      const latR = o.lat * DEG, lonR = o.lon * DEG, hdg = (o.hdgDeg || 0) * DEG;
      const real = !!this.S.realistic && def.engine.type !== 'winch';
      if (o.onGround) {
        c.flapIndex = def.flaps ? def.flaps.to : 0;
        fm.reset({ lat: latR, lon: lonR, heading: hdg, onGround: true, ground, flaps: def.flaps ? def.flaps.values[c.flapIndex] : 0, engineOff: real });
        c.throttle = 0;
        c.gearDown = true;
        if (real) {
          // gerçekçi mod: motor kapalı, park freni çekili başla
          c.engineOn = false;
          c.parkingBrake = true;
        }
      } else {
        const spd = (o.speedKt || def.speeds.cruise) * KT;
        const alt = Math.max(refGround, ground) + (o.altAglFt || 2000) * FT;
        c.flapIndex = o.flapIndex || 0;
        c.gearDown = !!o.gearDown || !def.gear.retractable;
        const flaps = def.flaps ? def.flaps.values[c.flapIndex] : 0;
        // hazır trim: bu hızda düz uçuş için gereken hücum açısı
        const rho = GS.atmosphere(alt).rho;
        const CL0 = def.CL0 + (def.flaps ? flaps * def.flaps.dCL : 0);
        const CLreq = (def.mass * 9.81) / (0.5 * rho * spd * spd * def.S);
        const aReq = (CLreq - CL0) / def.CLa;
        const eq = (aReq - def.ctrl.alpha0) / (def.ctrl.Pa / def.ctrl.Ka);
        c.trim = clamp(eq / def.ctrl.trim, -1, 1);
        const gamma = o.gamma || 0;
        c.throttle = def.engine.type === 'winch' ? 0 : o.approach ? 0.42 : 0.62;
        fm.reset({ lat: latR, lon: lonR, heading: hdg, onGround: false, alt, speed: spd, throttle: def.engine.type === 'jet' ? c.throttle : 0.6, ground, gearDown: c.gearDown, flaps, pitch: aReq + gamma, trim: c.trim });
        fm.vel = GS.V.scale(GS.Q.rotate(GS.Q.fromHPR(hdg, gamma, 0), [0, 1, 0]), spd);
      }
      this.cam.resetView();
      this.cam.tower = null;
      ui.clearTrack();
      this.setDaytime(o.lon);
      this.cloudCenter = null;
      this.placeModel();
      this.cam.update(0.016, fm, this.enuM, this.groundEst);
      await this.waitTiles(token, 9000);
      if (token !== this.spawnToken) return;
      if (o.onGround && this.terrainOn) {
        // görüntülenen arazi yüksekliğine uydur
        const h = this.viewer.scene.globe.getHeight(Cesium.Cartographic.fromRadians(fm.lon, fm.lat, 0, this.carto));
        if (h !== undefined && isFinite(h)) {
          fm.alt += h - ground;
          fm.ground = h;
          this.groundEst = h;
        }
      }
      const save = Object.assign({}, o);
      if (save.icao) {
        this.S.spawn = { icao: save.icao, rwy: save.rwy, approach: !!save.approach };
      } else this.S.spawn = save;
      GS.Settings.save(this.S);
      this.lastSpawn = o;
      this.paused = false;
      ui.setPause(false);
      this.loading = false;
      ui.setLoading(null);
      this.last = performance.now();
      if (o.label) ui.toast(o.label);
      if (real && o.onGround) ui.toast('Gerçekçi mod: E ile motoru çalıştırın, Shift+B ile park frenini bırakın.', 'info', 7000);
    }

    waitTiles(token, maxMs) {
      return new Promise((res) => {
        const t0 = performance.now();
        const tick = () => {
          if (token !== this.spawnToken) return res();
          const el = performance.now() - t0;
          if ((this.viewer.scene.globe.tilesLoaded && el > 700) || el > maxMs) return res();
          requestAnimationFrame(tick);
        };
        tick();
      });
    }

    reset() {
      if (this.lastSpawn) this.spawn(this.lastSpawn);
      else this.restoreSpawn();
    }

    respawnHere() {
      const fm = this.fm;
      const o = { lat: fm.lat / DEG, lon: fm.lon / DEG, hdgDeg: fm.heading / DEG, label: 'Konum yenilendi' };
      if (fm.onGround || fm.crashed) o.onGround = true;
      else Object.assign(o, { onGround: false, altAglFt: Math.max(1500, fm.agl / FT), speedKt: Math.max(this.def.speeds.cruise, fm.ias / KT) });
      return this.spawn(o);
    }

    teleport(lat, lon) {
      const fm = this.fm, def = this.def;
      const agl = fm.onGround || fm.crashed ? (def.engine.type === 'winch' ? 2500 : 2000) : Math.max(1500, fm.agl / FT);
      this.spawn({ lat, lon, hdgDeg: fm.heading / DEG, onGround: false, altAglFt: agl, speedKt: def.speeds.cruise, label: 'Işınlandınız' });
    }

    async selectAircraft(id) {
      if (id === this.def.id) return;
      const fm = this.fm;
      const wasGround = fm.onGround || fm.crashed || this.loading;
      this.def = GS.getAircraft(id);
      this.S.aircraft = id;
      GS.Settings.save(this.S);
      fm.setAircraft(this.def);
      this.ap.disengage();
      this.ap.setDefaults(this.def);
      this.nodes = null;
      await this.loadModel();
      if (wasGround && this.lastSpawn && !this.lastSpawn.approach) await this.spawn(this.lastSpawn);
      else if (wasGround) await this.spawn({ lat: fm.lat / DEG, lon: fm.lon / DEG, hdgDeg: fm.heading / DEG, onGround: true });
      else if (this.lastSpawn && this.lastSpawn.approach) await this.reset();
      else await this.spawn({ lat: fm.lat / DEG, lon: fm.lon / DEG, hdgDeg: fm.heading / DEG, onGround: false, altAglFt: Math.max(1500, fm.agl / FT), speedKt: this.def.speeds.cruise });
      this.ui.toast(this.def.name);
    }

    // ---------- eylemler ----------
    action(a, arg) {
      const c = this.controls, def = this.def, fm = this.fm, ui = this.ui;
      switch (a) {
        case 'any':
          this.sound.unlock();
          break;
        case 'gear':
          if (!def.gear.retractable) return ui.toast('Bu uçağın iniş takımı sabit.');
          if (fm.wheelsDown > 0 && c.gearDown) return ui.toast('Yerdeyken iniş takımı toplanamaz.', 'warn');
          c.gearDown = !c.gearDown;
          this.sound.clunk();
          ui.toast(c.gearDown ? 'İniş takımı indiriliyor' : 'İniş takımı toplanıyor');
          break;
        case 'flapsDown':
        case 'flapsUp': {
          if (!def.flaps) return ui.toast('Bu uçakta flap yok.');
          const n = def.flaps.values.length;
          c.flapIndex = clamp(c.flapIndex + (a === 'flapsDown' ? 1 : -1), 0, n - 1);
          ui.toast('Flap ' + def.flaps.labels[c.flapIndex]);
          break;
        }
        case 'spoilers':
          if (!def.spoilers) return ui.toast('Bu uçakta spoiler yok.');
          c.spoilers = !c.spoilers;
          ui.toast(def.engine.type === 'winch' ? (c.spoilers ? 'Hava freni açık' : 'Hava freni kapalı') : c.spoilers ? 'Spoiler açık' : 'Spoiler kapalı');
          break;
        case 'engine':
          if (def.engine.type === 'winch') return ui.toast('Planörün motoru yok. Pistte gazı artırınca vinç çeker.');
          c.engineOn = !c.engineOn;
          if (c.engineOn && this.S.realistic) {
            if (def.fuel && fm.fuel <= 0) ui.toast('Yakıt yok, motor çalışmaz.', 'warn');
            else ui.toast(def.engine.type === 'jet' ? 'Motor çalıştırılıyor (yaklaşık ' + def.engine.startTime + ' sn)…' : 'Marş basılıyor…');
          } else ui.toast(c.engineOn ? 'Motor çalıştırıldı' : 'Motor durduruldu', c.engineOn ? 'info' : 'warn');
          break;
        case 'autopilot':
          this.toggleAP();
          break;
        case 'camera':
          this.setCamera(GS.CameraRig.MODES[(GS.CameraRig.MODES.indexOf(this.cam.mode) + 1) % 4]);
          break;
        case 'cameraSet':
          this.setCamera(arg);
          break;
        case 'map':
          ui.toggleMap();
          break;
        case 'panel':
          this.S.panel = !this.S.panel;
          GS.Settings.save(this.S);
          this.applyPanel();
          break;
        case 'hud':
          this.S.hud = !this.S.hud;
          GS.Settings.save(this.S);
          ui.syncSetting('hud');
          break;
        case 'pause':
          this.togglePause();
          break;
        case 'reset':
          this.reset();
          break;
        case 'mouseYoke':
          this.S.control = this.S.control === 'mouse' ? 'keyboard' : 'mouse';
          GS.Settings.save(this.S);
          ui.syncSetting('control');
          this.applySetting('control');
          break;
        case 'help':
          ui.togglePanel('help');
          break;
        case 'escape':
          if (ui.current) ui.closePanel();
          else if (!$('#mapbox').hidden) ui.toggleMap(false);
          break;
        case 'parkingBrake':
          c.parkingBrake = !c.parkingBrake;
          ui.toast(c.parkingBrake ? 'Park freni çekildi' : 'Park freni bırakıldı');
          break;
        case 'gamepad':
          ui.toast('Oyun kumandası bağlandı');
          break;
      }
    }

    toggleAP() {
      const fm = this.fm, ui = this.ui;
      if (!this.ap.on) {
        if (fm.onGround || fm.crashed) return ui.toast('Otopilot yerde açılamaz.', 'warn');
        this.ap.engage(fm, { throttle: this.controls.throttle });
        this.sound.beep(1400);
        ui.toast('Otopilot açık');
      } else {
        this.ap.disengage();
        this.sound.beep(700, 0.3);
        ui.toast('Otopilot kapalı', 'warn');
      }
      ui.renderAP();
    }

    setCamera(mode) {
      if (!this.cam) return;
      this.cam.setMode(mode, this.fm);
      this.ui.markCamera(mode);
      this.instruments.cockpit = mode === 'cockpit';
      document.body.classList.toggle('cockpit', mode === 'cockpit');
      this.ui.toast(GS.CameraRig.name(mode));
    }

    togglePause() {
      if (this.loading || this.fm.crashed) return;
      this.paused = !this.paused;
      this.ui.setPause(this.paused);
    }

    applySetting(key) {
      const S = this.S;
      switch (key) {
        case 'imagery':
          this.applyImagery();
          break;
        case 'quality':
          this.applyQuality();
          break;
        case 'shadows':
          if (this.viewer) this.viewer.shadows = S.shadows;
          if (this.model) this.model.shadows = S.shadows ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED;
          break;
        case 'clouds':
          this.cloudCenter = null;
          this.updateClouds();
          break;
        case 'realTime':
          this.setDaytime(this.fm.lon / DEG);
          break;
        case 'terrain':
        case 'buildings':
        case 'ionToken':
          this.applyTerrain(true);
          break;
        case 'control':
          if (this.cam) this.cam.mouseYoke = S.control === 'mouse';
          document.body.classList.toggle('mouse-yoke', S.control === 'mouse');
          this.ui.toast(S.control === 'mouse' ? 'Fare ile kontrol açık. Kamerayı sağ tıkla sürükleyerek çevirin.' : 'Klavye ile kontrol');
          break;
        case 'realistic':
          this.fm.setRealism(S.realistic);
          this.instruments.realistic = !!S.realistic;
          this.ui.toast(S.realistic ? 'Gerçekçi mod açık. Bir sonraki başlangıçta motor kapalı olacak.' : 'Gerçekçi mod kapalı');
          break;
        case 'sound':
        case 'volume':
          this.sound.setEnabled(S.sound, S.volume);
          break;
      }
    }

    // ---------- bulutlar ----------
    updateClouds() {
      const v = this.viewer;
      if (!v) return;
      const count = { none: 0, few: 40, many: 120 }[this.S.clouds] || 0;
      if (!count) {
        if (this.clouds) this.clouds.removeAll();
        this.cloudCenter = null;
        return;
      }
      const fm = this.fm;
      if (this.cloudCenter) {
        const dN = (fm.lat - this.cloudCenter[0]) * 6371000;
        const dE = (fm.lon - this.cloudCenter[1]) * 6371000 * Math.cos(fm.lat);
        if (Math.hypot(dN, dE) < 12000) return;
      }
      if (!this.clouds) this.clouds = v.scene.primitives.add(new Cesium.CloudCollection());
      this.clouds.removeAll();
      this.cloudCenter = [fm.lat, fm.lon];
      const base = this.groundEst + 1300;
      for (let i = 0; i < count; i++) {
        const r = 22000 * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
        const la = fm.lat + (r * Math.cos(a)) / 6371000;
        const lo = fm.lon + (r * Math.sin(a)) / (6371000 * Math.cos(fm.lat));
        const w = 500 + Math.random() * 900;
        const h = w * (0.28 + Math.random() * 0.15);
        this.clouds.add({
          position: Cesium.Cartesian3.fromRadians(lo, la, base + Math.random() * 600),
          scale: new Cesium.Cartesian2(w, h),
          maximumSize: new Cesium.Cartesian3(w, h, h * 1.1),
          slice: 0.3 + Math.random() * 0.2,
          brightness: 0.95 + Math.random() * 0.05,
        });
      }
    }

    // ---------- ana döngü ----------
    updateGround(dt) {
      if (!this.terrainOn) {
        this.groundEst = 0;
        return;
      }
      const fm = this.fm;
      const h = this.viewer.scene.globe.getHeight(Cesium.Cartographic.fromRadians(fm.lon, fm.lat, 0, this.carto));
      if (h === undefined || !isFinite(h)) return;
      const rate = fm.onGround ? 3 : 90;
      this.groundEst += clamp(h - this.groundEst, -rate * dt, rate * dt);
    }

    handleEvents() {
      const ui = this.ui;
      for (const e of this.fm.popEvents()) {
        if (e.type === 'touchdown') {
          const fpm = e.vs / FPM;
          const r = fpm < 120 ? 'tüy gibi!' : fpm < 300 ? 'güzel iniş' : fpm < 550 ? 'biraz sert' : 'çok sert';
          ui.toast(`Teker koydu: ${Math.round(fpm)} ft/dk, ${r}`, fpm < 550 ? 'good' : 'warn', 4000);
          this.sound.touchdown(e.vs);
        } else if (e.type === 'crash') {
          this.sound.crash();
          this.ap.disengage();
          ui.renderAP();
          ui.showCrash(e.reason);
        } else if (e.type === 'winch-release') {
          ui.toast('Vinç halatı bırakıldı. İyi süzülüşler!');
          this.controls.throttle = 0;
        } else if (e.type === 'engine-started') {
          ui.toast('Motor çalıştı', 'good');
        } else if (e.type === 'fuel-low') {
          ui.toast('Yakıt azaldı: %10 kaldı', 'warn', 5000);
          this.sound.beep(900, 0.25);
        } else if (e.type === 'fuel-out') {
          ui.toast('Yakıt bitti, motor durdu. Süzülerek inin!', 'warn', 7000);
          this.sound.beep(600, 0.5);
        } else if (e.type === 'overstress') {
          ui.toast(`Aşırı G yükü: ${e.g.toFixed(1)} G. Sınırı aşmaya devam ederseniz uçak kırılır.`, 'warn', 4000);
          this.sound.beep(1000, 0.3);
        } else if (e.type === 'overspeed') {
          ui.toast('Azami hız aşıldı! Gazı azaltın, burnu kaldırın.', 'warn', 4000);
          this.sound.beep(1600, 0.4);
        } else if (e.type === 'flaps-damaged') {
          ui.toast('Flaplar yüksek hızda hasar gördü ve kilitlendi.', 'warn', 6000);
        } else if (e.type === 'gear-damaged') {
          ui.toast('İniş takımı yüksek hızda hasar gördü ve kilitlendi.', 'warn', 6000);
        } else if (e.type === 'scrape') {
          const now = performance.now();
          if (now - this.timers.scrape > 4000) {
            ui.toast('Gövde yere sürtüyor!', 'warn');
            this.timers.scrape = now;
          }
        }
      }
    }

    frame() {
      const now = performance.now();
      let dt = (now - (this.last || now)) / 1000;
      this.last = now;
      if (dt <= 0) dt = 1 / 60;
      this.fps += (1 / Math.max(dt, 0.004) - this.fps) * 0.05;
      dt = Math.min(dt, 0.1);
      const S = this.S, fm = this.fm, def = this.def;
      this.controls.update(dt);
      this.updateGround(dt);
      if (!this.paused && !this.loading && !fm.crashed) {
        const inp = this.controls.input(def);
        if (S.autoRudder && !S.realistic && !fm.onGround && !this.ap.on) {
          inp.rudder = clamp(inp.rudder + (fm.beta || 0) * 3 + (def.ctrl.Na / def.ctrl.Ya) * inp.aileron * 0.8, -1, 1);
        }
        if (this.ap.on) {
          this.ap.update(dt, fm, inp);
          if (def.engine.type !== 'winch') this.controls.throttle = inp.throttle;
        }
        const ws = (S.windKt || 0) * KT, wd = (S.windDir || 0) * DEG;
        this.env.wind = [-Math.sin(wd) * ws, -Math.cos(wd) * ws, 0];
        this.env.turbulence = clamp(S.turb || 0, 0, 1);
        fm.ground = this.groundEst;
        fm.step(dt, inp);
        this.handleEvents();
      }
      this.placeModel();
      this.animate(dt);
      this.cam.update(dt, fm, this.enuM, this.groundEst);
      if (S.panel) this.instruments.draw(fm, this.controls, this.ap, dt);
      this.sound.update(fm, this.paused || this.loading, this.cam.mode === 'cockpit');
      this.timers.hud += dt;
      this.timers.map += dt;
      this.timers.clouds += dt;
      if (this.timers.hud > 0.15) {
        this.timers.hud = 0;
        this.ui.updateHud(fm, this.fps);
        if (this.ap.on && this.ui.current === 'autopilot') this.ui.renderAP();
      }
      if (this.timers.map > 0.4) {
        this.timers.map = 0;
        this.ui.updateMap(fm);
      }
      if (this.timers.clouds > 2) {
        this.timers.clouds = 0;
        if (!this.loading) this.updateClouds();
      }
    }
  }

  window.addEventListener('error', (e) => console.error('GökSim hata:', e.message));
  const boot = () => {
    const app = new App();
    window.goksim = app;
    app.start().catch((e) => {
      console.error(e);
      app.ui.setLoading('Başlatma hatası: ' + e.message);
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
