/* Animated surface-current layer for Leaflet.
   Data: data/currents.json (regular lat/lon grid, hourly east/north components in cm/s, land mask).
   Particles drift with the current at the replay time; their trails fade, giving a flow-pattern picture. */
(function () {
  'use strict';
  const KN = 1.94384; // m/s -> knots

  function Field(d) {
    const g = d.grid, n = g.nLat * g.nLon;
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
      const near = (Math.round(fy) * g.nLon + Math.round(fx));
      if (!mask[near]) return null;
      const cells = [[j * g.nLon + i, (1 - ay) * (1 - ax)], [j * g.nLon + i + 1, (1 - ay) * ax], [(j + 1) * g.nLon + i, ay * (1 - ax)], [(j + 1) * g.nLon + i + 1, ay * ax]];
      let e = 0, nn = 0, w = 0;
      const [k0, k1, f] = fr;
      for (const [c, cw] of cells) {
        if (!mask[c]) continue;
        e += cw * (U[k0][c] * (1 - f) + U[k1][c] * f);
        nn += cw * (V[k0][c] * (1 - f) + V[k1][c] * f);
        w += cw;
      }
      return w ? [e / w / 100, nn / w / 100] : null;
    }
    return { at, frame, maxSp, grid: g };
  }

  const RAMP = {
    dark: ['rgba(134,182,239,0.30)', 'rgba(158,197,244,0.40)', 'rgba(205,226,251,0.52)', 'rgba(235,244,255,0.64)', 'rgba(255,255,255,0.75)'],
    light: ['rgba(110,150,210,0.30)', 'rgba(57,135,229,0.40)', 'rgba(42,120,214,0.52)', 'rgba(28,92,171,0.64)', 'rgba(13,54,107,0.75)'],
  };
  const BREAKS_KN = [0.5, 1, 2, 3]; // bucket edges

  const CurrentLayer = L.Layer.extend({
    initialize(data, getTime, getTheme) {
      this.field = Field(data);
      this.getTime = getTime;
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
      const zoom = map.getZoom();
      this.pxPerMs = 3.2 * Math.pow(2, (zoom - 11) * 0.6); // px per frame for 1 m/s
      const count = Math.round(Math.min(3000, Math.max(600, (size.x * size.y) / 170)));
      this.parts = Array.from({ length: count }, () => this._spawn({}, true));
      this.paused = false;
    },
    _spawn(p, initial) {
      for (let tries = 0; tries < 20; tries++) {
        p.x = Math.random() * this.w; p.y = Math.random() * this.h;
        if (this.field.at(this.lat(p.y), this.lon(p.x), this.fr || [0, 0, 0])) break;
      }
      p.age = initial ? Math.floor(Math.random() * 80) : 0;
      p.max = 70 + Math.floor(Math.random() * 70);
      return p;
    },
    _step() {
      if (this.paused || !this.ctx) return;
      const ctx = this.ctx, f = this.field;
      this.fr = f.frame(this.getTime());
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(0,0,0,0.94)';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'source-over';
      const ramp = RAMP[this.getTheme()];
      const buckets = ramp.map(() => []);
      for (const p of this.parts) {
        if (p.age++ > p.max) { this._spawn(p); continue; }
        const v = f.at(this.lat(p.y), this.lon(p.x), this.fr);
        if (!v) { this._spawn(p); continue; }
        const nx = p.x + v[0] * this.pxPerMs, ny = p.y - v[1] * this.pxPerMs;
        const kn = Math.hypot(v[0], v[1]) * KN;
        let b = 0; while (b < BREAKS_KN.length && kn >= BREAKS_KN[b]) b++;
        buckets[b].push(p.x, p.y, nx, ny);
        p.x = nx; p.y = ny;
        if (nx < 0 || ny < 0 || nx > this.w || ny > this.h) this._spawn(p);
      }
      ctx.lineWidth = 1.2;
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
