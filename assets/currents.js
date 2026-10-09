/* Animated surface-current layer for Leaflet.
   Data: data/currents.json (regular lat/lon grid, hourly east/north components in cm/s, land mask).
   Particles drift with the current at the replay time; their trails fade, giving a flow-pattern picture. */
(function () {
  'use strict';
  const KN = 1.94384; // m/s -> knots

  // Real shoreline (OpenStreetMap), 1 bit per ~30 m cell: 1 = water
  function Coast(c) {
    if (!c) return null;
    const bin = atob(c.bits), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return (lat, lon) => {
      const j = Math.floor((lat - c.lat0) / c.dlat), i = Math.floor((lon - c.lon0) / c.dlon);
      if (j < 0 || i < 0 || j >= c.nLat || i >= c.nLon) return false;
      const k = j * c.nLon + i;
      return (bytes[k >> 3] >> (7 - (k & 7))) & 1;
    };
  }

  function Field(d, coast) {
    const g = d.grid, n = g.nLat * g.nLon;
    const isWater = Coast(coast);
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = d.mask.charCodeAt(i) === 49;
    const U = d.u.map((a) => Int16Array.from(a)), V = d.v.map((a) => Int16Array.from(a));
    const T = d.times;
    let maxSp = 0;
    U.forEach((u, k) => { for (let i = 0; i < n; i++) if (mask[i]) maxSp = Math.max(maxSp, Math.hypot(u[i], V[k][i]) / 100); });
    function frame(t) {
      if (t <= T[0]) return [0, 0, 0];
      if (t >= T[T.length - 1]) return [T.length - 1, T.length - 1, 0];
      let k = 0; while (T[k + 1] < t) k++;
      return [k, k + 1, (t - T[k]) / (T[k + 1] - T[k])];
    }
    // returns [east, north] in m/s, or null on land / outside the grid
    function at(lat, lon, fr) {
      const fy = (lat - g.lat0) / g.dlat, fx = (lon - g.lon0) / g.dlon;
      const j = Math.floor(fy), i = Math.floor(fx);
      if (j < 0 || i < 0 || j >= g.nLat - 1 || i >= g.nLon - 1) return null;
      const ay = fy - j, ax = fx - i;
      if (isWater) { if (!isWater(lat, lon)) return null; }
      else if (!mask[Math.round(fy) * g.nLon + Math.round(fx)]) return null;
      const cells = [[j * g.nLon + i, (1 - ay) * (1 - ax)], [j * g.nLon + i + 1, (1 - ay) * ax], [(j + 1) * g.nLon + i, ay * (1 - ax)], [(j + 1) * g.nLon + i + 1, ay * ax]];
      let e = 0, nn = 0, w = 0;
      const [k0, k1, f] = fr;
      for (const [c, cw] of cells) {
        if (!isWater && !mask[c]) continue;
        e += cw * (U[k0][c] * (1 - f) + U[k1][c] * f);
        nn += cw * (V[k0][c] * (1 - f) + V[k1][c] * f);
        w += cw;
      }
      return w ? [e / w / 100, nn / w / 100] : null;
    }
    return { at, frame, maxSp, grid: g };
  }

  const RAMP = {
    dark: ['rgba(134,182,239,0.20)', 'rgba(158,197,244,0.28)', 'rgba(205,226,251,0.37)', 'rgba(235,244,255,0.46)', 'rgba(255,255,255,0.55)'],
    light: ['rgba(110,150,210,0.20)', 'rgba(57,135,229,0.28)', 'rgba(42,120,214,0.37)', 'rgba(28,92,171,0.46)', 'rgba(13,54,107,0.55)'],
  };
  const BREAKS_KN = [0.5, 1, 2, 3]; // bucket edges

  const CurrentLayer = L.Layer.extend({
    initialize(data, getTime, getTheme, getRate, coast) {
      this.field = Field(data, coast);
      this.getTime = getTime;
      this.getRate = getRate || (() => 1); // race seconds shown per real second (the replay speed)
      this.getTheme = getTheme;
      this.parts = [];
    },
    onAdd(map) {
      this.map = map;
      this.canvas = L.DomUtil.create('canvas', 'current-canvas');
      this.canvas.style.pointerEvents = 'none';
      map.getPanes().overlayPane.appendChild(this.canvas);
      map.on('movestart zoomstart', this._pause, this);
      map.on('moveend zoomend resize', this._reset, this);
      this._reset();
      this.running = true;
      const loop = () => { if (!this.running) return; this._step(); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    },
    onRemove(map) {
      this.running = false; cancelAnimationFrame(this.raf);
      map.off('movestart zoomstart', this._pause, this);
      map.off('moveend zoomend resize', this._reset, this);
      this.canvas.remove();
    },
    _pause() { this.paused = true; if (this.ctx) this.ctx.clearRect(0, 0, this.w, this.h); },
    _reset() {
      const map = this.map, size = map.getSize(), dpr = window.devicePixelRatio || 1;
      this.w = size.x; this.h = size.y; this.dpr = dpr;
      this.canvas.width = size.x * dpr; this.canvas.height = size.y * dpr;
      this.canvas.style.width = size.x + 'px'; this.canvas.style.height = size.y + 'px';
      L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]));
      this.ctx = this.canvas.getContext('2d');
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.lineCap = 'round';
      // projection helpers: linear is accurate to well under a pixel over this small area
      const nw = map.containerPointToLatLng([0, 0]), se = map.containerPointToLatLng([size.x, size.y]);
      this.lat = (y) => nw.lat + (se.lat - nw.lat) * (y / size.y);
      this.lon = (x) => nw.lng + (se.lng - nw.lng) * (x / size.x);
      // metres per screen pixel at the centre of the view, so streaks move at the true current speed
      const cx = size.x / 2, cy = size.y / 2;
      this.mpp = map.distance(map.containerPointToLatLng([cx - 50, cy]), map.containerPointToLatLng([cx + 50, cy])) / 100;
      this.last = null;
      const count = Math.round(Math.min(3000, Math.max(600, (size.x * size.y) / 170)));
      this.parts = Array.from({ length: count }, () => this._spawn({}, true));
      this.paused = false;
    },
    _spawn(p, initial) {
      for (let tries = 0; tries < 40; tries++) {
        p.x = Math.random() * this.w; p.y = Math.random() * this.h;
        if (this.field.at(this.lat(p.y), this.lon(p.x), this.fr || [0, 0, 0])) break;
      }
      p.age = initial ? Math.random() * 5 : 0;      // seconds of real time
      p.max = 4 + Math.random() * 4;
      return p;
    },
    _step() {
      if (this.paused || !this.ctx) return;
      const ctx = this.ctx, f = this.field;
      const now = performance.now(), dt = this.last == null ? 1 / 60 : Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      // pixels moved this frame for 1 m/s of current: true speed, sped up by the replay rate
      const k = (this.getRate() * dt) / this.mpp;
      this.fr = f.frame(this.getTime());
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = `rgba(0,0,0,${Math.exp(-dt / 0.9).toFixed(4)})`;  // trails fade over about a second
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'source-over';
      const ramp = RAMP[this.getTheme()];
      const buckets = ramp.map(() => []);
      for (const p of this.parts) {
        p.age += dt;
        if (p.age > p.max) { this._spawn(p); continue; }
        const v = f.at(this.lat(p.y), this.lon(p.x), this.fr);
        if (!v) { this._spawn(p); continue; }
        const nx = p.x + v[0] * k, ny = p.y - v[1] * k;
        const kn = Math.hypot(v[0], v[1]) * KN;
        let b = 0; while (b < BREAKS_KN.length && kn >= BREAKS_KN[b]) b++;
        buckets[b].push(p.x, p.y, nx, ny);
        p.x = nx; p.y = ny;
        if (nx < 0 || ny < 0 || nx > this.w || ny > this.h) this._spawn(p);
      }
      ctx.lineWidth = 1.1;
      buckets.forEach((seg, b) => {
        if (!seg.length) return;
        ctx.strokeStyle = ramp[b];
        ctx.beginPath();
        for (let i = 0; i < seg.length; i += 4) { ctx.moveTo(seg[i], seg[i + 1]); ctx.lineTo(seg[i + 2], seg[i + 3]); }
        ctx.stroke();
      });
    },
    // current at a point and time, for read-outs: {kn, dirTo (deg true)}
    sample(lat, lon, t) {
      const v = this.field.at(lat, lon, this.field.frame(t));
      if (!v) return null;
      return { kn: Math.hypot(v[0], v[1]) * KN, dirTo: (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360 };
    },
  });

  window.RARCurrents = { CurrentLayer, RAMP, BREAKS_KN };
})();
