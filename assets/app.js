/* Race Around the Rock 2026 · race-day analytics
   Data: data/race.json, built from YB Tracking by tools/build_race_json.py
   Track rows: [secondsFromStart, lat, lon, distanceToFinish_m, cumulativeKm, speedKmh] */
(function () {
  'use strict';

  const STEP = 60;               // chart sampling, seconds
  const TRAIL = 30 * 60;         // map trail length for the field, seconds
  const SLOT = ['s1', 's2', 's3'];
  const DEFAULT = { crew: '204', vs: '205,202' }; // our crew; compared with the winner and the next crew ahead

  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  let R, crews, safety, byId, tMin, tMax, map, tiles = {};
  const state = { t: 3 * 3600, focus: null, cmp: [null, null], div: 'All', playing: false, speed: 300 };

  /* ---------- formatting ---------- */
  const tzFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hour12: false });
  const tzFmtS = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const clock = (t, sec) => (sec ? tzFmtS : tzFmt).format(new Date((R.raceStartEpoch + t) * 1000));
  function dur(s, short) {
    if (s == null || !isFinite(s)) return '–';
    const neg = s < 0; s = Math.abs(Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const out = h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
    if (short && h) return `${h}h ${String(m).padStart(2, '0')}m`;
    return (neg ? '−' : '') + out;
  }
  const pace = (kmh) => (kmh > 0.5 ? dur(1800 / kmh) : '–');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function shortName(c) {
    // "208 - Gorge Narrows RC - A" -> "Gorge Narrows RC - A"
    const parts = c.name.split(' - ');
    return parts.length > 1 ? parts.slice(1).join(' – ') : c.name;
  }

  /* ---------- track maths ---------- */
  function idxAt(tr, t) { // last index with tr[i][0] <= t
    let lo = 0, hi = tr.length - 1;
    if (t <= tr[0][0]) return 0;
    if (t >= tr[hi][0]) return hi;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tr[mid][0] <= t) lo = mid; else hi = mid; }
    return lo;
  }
  function at(c, t) {
    const tr = c.track, i = idxAt(tr, t), a = tr[i], b = tr[Math.min(i + 1, tr.length - 1)];
    const f = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0;
    const L = (k) => a[k] + (b[k] - a[k]) * f;
    let dtf = L(3);
    if (c.finish != null && t >= c.finish) dtf = 0;
    return { lat: L(1), lon: L(2), dtf, km: L(4), i };
  }
  function speedAt(c, t, back, fwd) { // km/h between t-back and t+fwd
    const t0 = Math.max(t - back, c.track[0][0]), t1 = Math.min(t + fwd, c.track[c.track.length - 1][0]);
    if (t1 - t0 < 60) return null;
    return (at(c, t1).km - at(c, t0).km) / ((t1 - t0) / 3600);
  }
  function timeAtDtf(c, d) { // first time after the start that crew c was within d metres of the finish
    const tr = c.track;
    for (let i = 1; i < tr.length; i++) {
      if (tr[i][0] < 0 || tr[i][3] == null) continue;
      if (tr[i][3] <= d) {
        const a = tr[i - 1], b = tr[i];
        if (a[3] == null || a[3] === b[3] || a[0] < 0) return b[0];
        const f = (a[3] - d) / (a[3] - b[3]);
        return a[0] + f * (b[0] - a[0]);
      }
    }
    return null;
  }
  const racing = (c, t) => t >= 0 && (c.finish == null || t < c.finish);
  const inDiv = (c) => state.div === 'All' || c.division === state.div;
  const slotOf = (c) => (state.focus === c.id ? 0 : state.cmp.indexOf(c.id) >= 0 ? state.cmp.indexOf(c.id) + 1 : -1);
  const selected = () => [state.focus, ...state.cmp].filter((x) => x != null).map((id) => byId[id]);

  /* ---------- leaderboard at time t ---------- */
  function standings(t) {
    const pool = crews.filter(inDiv);
    const rows = pool.map((c) => {
      const p = at(c, t);
      const done = c.finish != null && t >= c.finish;
      return { c, p, done };
    });
    rows.sort((a, b) => {
      if (a.done && b.done) return a.c.finish - b.c.finish;
      if (a.done) return -1;
      if (b.done) return 1;
      return a.p.dtf - b.p.dtf;
    });
    const lead = rows[0];
    rows.forEach((r, k) => {
      r.pos = k + 1;
      if (t < 0) { r.behind = null; return; }
      if (r.done) { r.behind = r.c.finish - lead.c.finish; return; }
      const lt = timeAtDtf(lead.c, r.p.dtf);
      r.behind = lt == null ? null : t - lt;
      r.pace = speedAt(r.c, t, 300, 0);
    });
    return rows;
  }

  /* ---------- precomputed results ---------- */
  function computeResults() {
    const fin = crews.filter((c) => c.finish != null).sort((a, b) => a.finish - b.finish);
    const win = fin[0];
    fin.forEach((c, k) => {
      c.place = k + 1;
      c.behindWinner = c.finish - win.finish;
      c.divPlace = fin.filter((x) => x.division === c.division && x.finish <= c.finish).length;
      c.divCount = crews.filter((x) => x.division === c.division).length;
      c.rowedKm = at(c, c.finish).km - at(c, 0).km;
      c.avg = R.courseKm / (c.finish / 3600);
    });
  }

  /* ---------- selectors ---------- */
  function fillSelectors() {
    const opts = crews.slice().sort((a, b) => a.place - b.place)
      .map((c) => `<option value="${c.id}">${esc(c.sail)} · ${esc(shortName(c))}</option>`).join('');
    $('focusSel').innerHTML = opts;
    $('cmpSel1').innerHTML = '<option value="">None</option>' + opts;
    $('cmpSel2').innerHTML = '<option value="">None</option>' + opts;
  }
  function readURL() {
    const q = new URLSearchParams(location.search);
    const bySail = (s) => crews.find((c) => String(c.sail).toLowerCase() === String(s).toLowerCase());
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('rar2026') || '{}'); } catch (e) { /* storage unavailable */ }
    const f = bySail(q.get('crew') || saved.crew || DEFAULT.crew);
    state.focus = f ? f.id : crews.find((c) => c.place === 1).id;
    const vs = (q.get('vs') ?? (saved.crew ? saved.vs : DEFAULT.vs) ?? '').split(',').map(bySail).filter(Boolean).map((c) => c.id).filter((id) => id !== state.focus);
    const winner = crews.find((c) => c.place === 1).id;
    state.cmp = [vs[0] ?? (winner !== state.focus ? winner : crews.find((c) => c.place === 2).id), vs[1] ?? null];
    if (q.get('div')) state.div = q.get('div');
    if (q.get('t') && isFinite(+q.get('t'))) state.t = +q.get('t');
  }
  function writeURL() {
    const q = new URLSearchParams();
    q.set('crew', byId[state.focus].sail);
    const vs = state.cmp.filter((x) => x != null).map((id) => byId[id].sail);
    if (vs.length) q.set('vs', vs.join(','));
    if (state.div !== 'All') q.set('div', state.div);
    history.replaceState(null, '', '?' + q.toString());
    try { localStorage.setItem('rar2026', JSON.stringify({ crew: q.get('crew'), vs: q.get('vs') || '' })); } catch (e) { /* ignore */ }
  }
  function syncSelectors() {
    $('focusSel').value = state.focus;
    $('cmpSel1').value = state.cmp[0] ?? '';
    $('cmpSel2').value = state.cmp[1] ?? '';
    $('divSel').value = state.div;
  }

  /* ---------- stats tiles ---------- */
  function renderStats() {
    const c = byId[state.focus];
    const legs = legTimes(c);
    const ranks = legRanks();
    let best = null;
    legs.forEach((v, k) => { const rk = ranks[k][c.id]; if (rk && (!best || rk < best.rk)) best = { k, rk }; });
    const tiles = [
      ['Overall', `${c.place}<small class="muted"> / ${crews.length}</small>`, `${c.division}: ${c.divPlace} of ${c.divCount}`],
      ['Finish time', dur(c.finish), `Crossed at ${clock(c.finish, true)}`],
      ['Behind the winner', c.behindWinner ? dur(c.behindWinner) : 'Winner', c.place === 1 ? 'First to finish' : `Winner: ${esc(shortName(crews.find((x) => x.place === 1)))}`],
      ['Average speed', `${c.avg.toFixed(2)}<small class="muted"> km/h</small>`, `${pace(c.avg)} per 500 m over ${R.courseKm} km`],
      ['GPS distance rowed', `${c.rowedKm.toFixed(1)}<small class="muted"> km</small>`, 'Start to finish, from the tracker'],
      ['Best leg', best ? `${ordinal(best.rk)}` : '–', best ? legNames()[best.k] : ''],
    ];
    $('stats').innerHTML = tiles.map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
  }
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

  /* ---------- splits ---------- */
  const gateList = () => R.gates.filter((g) => g.name.startsWith('Gate'));
  function legNames() {
    const g = gateList().map((x) => x.short);
    return ['Start → ' + g[0], ...g.slice(1).map((x, k) => `${g[k]} → ${x}`), g[g.length - 1] + ' → Finish'];
  }
  function legTimes(c) {
    const pts = [0, ...gateList().map((g) => c.splits[g.name] ?? null), c.finish];
    return pts.slice(1).map((v, k) => (v != null && pts[k] != null ? v - pts[k] : null));
  }
  function legRanks() {
    const pool = crews.filter(inDiv);
    return legNames().map((_, k) => {
      const arr = pool.map((c) => [c.id, legTimes(c)[k]]).filter((x) => x[1] != null).sort((a, b) => a[1] - b[1]);
      const out = {}; arr.forEach(([id], i) => { out[id] = i + 1; }); return out;
    });
  }
  function renderSplits() {
    const names = legNames(), ranks = legRanks();
    const pool = crews.filter(inDiv).sort((a, b) => a.finish - b.finish);
    let h = '<thead><tr><th>Crew</th>' + names.map((n) => `<th class="num">${esc(n)}</th>`).join('') + '<th class="num">Total</th></tr></thead><tbody>';
    pool.forEach((c) => {
      const s = slotOf(c), legs = legTimes(c);
      h += `<tr class="${s >= 0 ? 'hl' : ''}"><td><div class="crew"><span class="dot ${s >= 0 ? SLOT[s] : ''}"></span><span class="nm">${esc(c.sail)} · ${esc(shortName(c))}</span></div></td>`;
      legs.forEach((v, k) => {
        const rk = ranks[k][c.id];
        const txt = dur(v);
        h += `<td class="num">${rk === 1 ? `<b>${txt}</b>` : txt}<span class="rk">${rk ?? ''}</span></td>`;
      });
      h += `<td class="num">${dur(c.finish)}</td></tr>`;
    });
    $('splitsTable').innerHTML = h + '</tbody>';
  }
  function renderResults() {
    const rows = crews.slice().sort((a, b) => a.place - b.place);
    let h = '<thead><tr><th class="num">Place</th><th>Crew</th><th>Division</th><th class="num">Div.</th><th>Captain</th><th class="num">Finished</th><th class="num">Elapsed</th><th class="num">Behind</th><th class="num">Avg km/h</th><th class="num">Pace /500 m</th></tr></thead><tbody>';
    rows.forEach((c) => {
      const s = slotOf(c);
      h += `<tr class="${s >= 0 ? 'hl' : ''}"><td class="num">${c.place}</td><td><div class="crew"><span class="dot ${s >= 0 ? SLOT[s] : ''}"></span><span class="nm">${esc(c.sail)} · ${esc(shortName(c))}</span></div></td><td>${c.division}</td><td class="num">${c.divPlace}</td><td>${esc(c.captain || '')}</td><td class="num">${clock(c.finish, true)}</td><td class="num">${dur(c.finish)}</td><td class="num">${c.behindWinner ? '+' + dur(c.behindWinner) : '–'}</td><td class="num">${c.avg.toFixed(2)}</td><td class="num">${pace(c.avg)}</td></tr>`;
    });
    $('resultsTable').innerHTML = h + '</tbody>';
  }

  /* ---------- map ---------- */
  const isDark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const boats = {};
  function initMap() {
    map = L.map('map', { zoomSnap: 0.25, preferCanvas: false });
    tiles.light = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' });
    tiles.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' });
    tiles.sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' });
    setBase();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', setBase);

    const course = R.course.map((n) => [n[0], n[1]]);
    L.polyline(course, { color: '#ffffff', weight: 4, opacity: 0.55, interactive: false }).addTo(map);
    L.polyline(course, { color: '#5b6f7a', weight: 1.5, dashArray: '5 6', opacity: 0.9, interactive: false }).addTo(map);
    R.gates.forEach((g) => {
      const isGate = g.name.startsWith('Gate');
      const line = L.polyline([g.a, g.b], { color: isGate ? css('--gate') : '#d03b3b', weight: g.mandatory || !isGate ? 5 : 3, opacity: 0.95, dashArray: g.mandatory || !isGate ? null : '4 4' }).addTo(map);
      const label = isGate ? `G${g.name.match(/Gate (\d)/)[1]} ${g.short}${g.mandatory ? ' · mandatory' : ''}` : g.name;
      if (isGate) line.bindTooltip(label, { permanent: true, direction: 'center', className: 'gatelabel', offset: [0, -12] });
      else line.bindTooltip(label);
    });
    map.fitBounds(L.latLngBounds(course).pad(0.04));

    [...safety, ...crews].forEach((c) => {
      const trail = L.polyline([], { weight: 2, opacity: 0.8, interactive: false });
      const m = L.circleMarker([0, 0], { radius: 6, weight: 2, color: '#ffffff', fillOpacity: 1 });
      m.bindPopup('');
      m.on('click', () => m.setPopupContent(popupHtml(c)));
      m.bindTooltip(String(c.sail || 'S'), { permanent: true, direction: 'right', offset: [6, 0], className: 'boatlabel' });
      boats[c.id] = { c, m, trail };
    });
  }
  function setBase() {
    Object.values(tiles).forEach((l) => map.hasLayer(l) && map.removeLayer(l));
    (($('satChk') || {}).checked ? tiles.sat : isDark() ? tiles.dark : tiles.light).addTo(map);
  }
  function popupHtml(c) {
    if (c.safety) return `<b>${esc(c.name)}</b>`;
    const p = at(c, state.t);
    return `<b>${esc(c.sail)} · ${esc(shortName(c))}</b><br>${c.division}${c.captain ? ' · ' + esc(c.captain) : ''}<br>` +
      `At ${clock(state.t)}: ${(p.dtf / 1000).toFixed(1)} km to go<br>Final: ${ordinal(c.place)} in ${dur(c.finish)}`;
  }
  function styleBoats() {
    const showLabels = $('labelsChk').checked, showSafety = $('safetyChk').checked;
    const order = [];
    Object.values(boats).forEach((b) => {
      const c = b.c, s = c.safety ? -1 : slotOf(c);
      const visible = c.safety ? showSafety : inDiv(c) || s >= 0;
      b.visible = visible;
      if (!visible) { map.removeLayer(b.m); map.removeLayer(b.trail); return; }
      const col = c.safety ? '#d03b3b' : s >= 0 ? css('--' + SLOT[s]) : css('--field');
      b.full = s >= 0;
      b.m.setStyle({ fillColor: col, radius: s >= 0 ? 8 : c.safety ? 4 : 6, color: s >= 0 ? '#ffffff' : 'rgba(255,255,255,.85)' });
      b.trail.setStyle({ color: col, weight: s >= 0 ? 3 : 2, opacity: s >= 0 ? 0.95 : 0.6 });
      b.m.addTo(map); b.trail.addTo(map);
      const tt = b.m.getTooltip();
      if (showLabels && !c.safety) { if (!b.m.isTooltipOpen()) b.m.openTooltip(); } else { b.m.closeTooltip(); }
      if (tt) tt.options.permanent = showLabels && !c.safety;
      order.push([s, b]);
    });
    order.sort((a, b) => (a[0] === -1 ? 9 : 3 - a[0]) - (b[0] === -1 ? 9 : 3 - b[0]));
    order.reverse().forEach(([, b]) => { b.trail.bringToFront(); });
    order.forEach(([, b]) => { b.m.bringToFront(); });
  }
  function updateBoats() {
    const t = state.t, trails = $('trailsChk').checked;
    Object.values(boats).forEach((b) => {
      if (!b.visible) return;
      const p = at(b.c, t);
      b.m.setLatLng([p.lat, p.lon]);
      if (!trails) { b.trail.setLatLngs([]); return; }
      const from = b.full ? Math.min(0, t) : t - TRAIL;
      const tr = b.c.track, pts = [];
      for (let i = idxAt(tr, from); i <= p.i; i++) if (tr[i][0] >= from) pts.push([tr[i][1], tr[i][2]]);
      pts.push([p.lat, p.lon]);
      b.trail.setLatLngs(pts);
    });
  }

  /* ---------- leaderboard ---------- */
  function renderBoard() {
    const t = state.t, rows = standings(t);
    $('boardTime').textContent = `${clock(t)} · ${t < 0 ? 'before the start' : rows.every((r) => r.done) ? 'all finished' : dur(t, true) + ' in'}`;
    $('lbBody').innerHTML = rows.map((r) => {
      const c = r.c, s = slotOf(c);
      const right = r.done
        ? `<td class="num fin">${r.pos === 1 ? dur(c.finish) : '+' + dur(r.behind)}</td><td class="num tag">Finished</td>`
        : `<td class="num">${t < 0 ? '–' : r.pos === 1 ? 'Leader' : r.behind == null ? '–' : '+' + dur(r.behind)}</td><td class="num">${t <= 0 ? '–' : pace(r.pace)}</td>`;
      return `<tr class="${s >= 0 ? 'hl' : ''}" data-id="${c.id}"><td>${r.pos}</td><td><div class="crew"><span class="dot ${s >= 0 ? SLOT[s] : ''}"></span><span class="nm">${esc(c.sail)} · ${esc(shortName(c))}</span></div>` +
        `<small>${t < 0 ? c.division : r.done ? c.division : (r.p.dtf / 1000).toFixed(1) + ' km to go'}</small></td>${right}</tr>`;
    }).join('');
  }

  /* ---------- charts ---------- */
  const series = {};
  function buildSeries() {
    const pool = crews.filter((c) => inDiv(c) || slotOf(c) >= 0);
    const times = [];
    for (let t = 0; t <= tMax; t += STEP) times.push(t);
    const fieldPool = crews.filter(inDiv);
    const lead = times.map((t) => Math.min(...fieldPool.map((c) => at(c, t).dtf)));
    series.times = times;
    series.gap = {}; series.speed = {};
    pool.forEach((c) => {
      series.gap[c.id] = times.map((t, k) => (racing(c, t) || t === c.finish ? Math.max(0, (at(c, t).dtf - lead[k]) / 1000) : null));
      series.speed[c.id] = times.map((t) => (racing(c, t) && t >= 300 && t <= c.finish - 300 ? speedAt(c, t, 300, 300) : null));
    });
    series.band = times.map((t, k) => {
      const v = fieldPool.map((c) => series.speed[c.id] && series.speed[c.id][k]).filter((x) => x != null).sort((a, b) => a - b);
      if (v.length < 3) return null;
      const q = (p) => { const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
      return [q(0.25), q(0.5), q(0.75)];
    });
  }

  const charts = {};
  function drawChart(key, opts) {
    const el = $(opts.el), W = el.clientWidth, H = el.clientHeight;
    if (!W) return;
    const m = { l: 40, r: 12, t: 10, b: 24 };
    const times = series.times;
    const x = (t) => m.l + (t / times[times.length - 1]) * (W - m.l - m.r);
    const yMax = opts.yMax(), yMin = opts.yMin || 0;
    const y = (v) => H - m.b - ((v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
    const path = (arr) => {
      let d = '', pen = false;
      arr.forEach((v, k) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(times[k]).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; });
      return d;
    };
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">`;
    // grid + y ticks
    s += '<g class="grid">';
    opts.yTicks.forEach((v) => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`; });
    s += '</g><g class="axis">';
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
    for (let h = 0; h * 3600 <= times[times.length - 1]; h++) {
      const tx = x(h * 3600);
      s += `<line x1="${tx}" x2="${tx}" y1="${H - m.b}" y2="${H - m.b + 4}"/><text x="${tx}" y="${H - 6}" text-anchor="middle">${clock(h * 3600)}</text>`;
    }
    s += '</g>';
    if (opts.band) {
      const b = series.band; let up = '', dn = '';
      const segs = []; let cur = [];
      b.forEach((v, k) => { if (v) cur.push([k, v]); else if (cur.length) { segs.push(cur); cur = []; } });
      if (cur.length) segs.push(cur);
      segs.forEach((sg) => {
        up = sg.map(([k, v], i) => (i ? 'L' : 'M') + x(times[k]).toFixed(1) + ' ' + y(v[2]).toFixed(1)).join('');
        dn = sg.slice().reverse().map(([k, v]) => 'L' + x(times[k]).toFixed(1) + ' ' + y(v[0]).toFixed(1)).join('');
        s += `<path d="${up}${dn}Z" fill="var(--field-band)"/>`;
      });
      s += `<path d="${path(b.map((v) => (v ? v[1] : null)))}" fill="none" stroke="var(--field)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    }
    if (opts.fieldLines) {
      crews.filter(inDiv).filter((c) => slotOf(c) < 0).forEach((c) => {
        s += `<path d="${path(opts.data[c.id])}" fill="none" stroke="var(--field)" stroke-width="1" opacity="0.8"/>`;
      });
    }
    selected().slice().reverse().forEach((c) => {
      const sl = slotOf(c);
      s += `<path d="${path(opts.data[c.id])}" fill="none" stroke="var(--${SLOT[sl]})" stroke-width="2.25" stroke-linejoin="round"/>`;
    });
    s += `<line class="cursor" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-2)" stroke-width="1"/>`;
    s += `<line class="hover" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3" visibility="hidden"/>`;
    s += '</svg>';
    el.innerHTML = s;
    const svg = el.firstChild;
    charts[key] = { svg, x, m, W, cursor: svg.querySelector('.cursor'), hover: svg.querySelector('.hover') };
    const tFromEvent = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const t = ((px - m.l) / (W - m.l - m.r)) * times[times.length - 1];
      return Math.max(0, Math.min(times[times.length - 1], t));
    };
    svg.addEventListener('mousemove', (ev) => {
      const t = tFromEvent(ev), k = Math.round(t / STEP);
      charts[key].hover.setAttribute('x1', x(times[k])); charts[key].hover.setAttribute('x2', x(times[k]));
      charts[key].hover.setAttribute('visibility', 'visible');
      let h = `<div class="t">${clock(times[k])}</div>`;
      selected().forEach((c) => {
        const v = opts.data[c.id] ? opts.data[c.id][k] : null;
        h += `<div class="r"><span><span class="dot ${SLOT[slotOf(c)]}"></span>${esc(c.sail)} · ${esc(shortName(c)).slice(0, 22)}</span><b>${v == null ? (t > c.finish ? 'Finished' : '–') : opts.fmt(v)}</b></div>`;
      });
      if (opts.band && series.band[k]) h += `<div class="r"><span><span class="dot"></span>Field median</span><b>${opts.fmt(series.band[k][1])}</b></div>`;
      showTip(h, ev);
    });
    svg.addEventListener('mouseleave', () => { charts[key].hover.setAttribute('visibility', 'hidden'); hideTip(); });
    svg.addEventListener('click', (ev) => { setTime(tFromEvent(ev)); });
    moveCursor();
  }
  function niceTicks(max, n) {
    const raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => max / s <= n) || mag * 10;
    const out = []; for (let v = 0; v <= max + 1e-9; v += step) out.push(+v.toFixed(2)); return { ticks: out, max: out[out.length - 1] };
  }
  function drawCharts() {
    const gapMax = Math.max(1, ...Object.entries(series.gap).filter(([id]) => inDiv(byId[id]) || slotOf(byId[id]) >= 0).flatMap(([, a]) => a.filter((v) => v != null)));
    const g = niceTicks(gapMax, 5);
    drawChart('gap', { el: 'chartGap', label: 'Distance behind the leader over the race', data: series.gap, yMax: () => g.max, yTicks: g.ticks, fieldLines: true, fmt: (v) => v.toFixed(2) + ' km' });
    const spAll = Object.values(series.speed).flat().filter((v) => v != null).sort((a, b) => a - b);
    const sMax = Math.ceil((spAll[Math.floor(spAll.length * 0.995)] || 14) + 0.5);
    const sMin = Math.max(0, Math.floor(spAll[Math.floor(spAll.length * 0.01)] || 0) - 1);
    const st = []; for (let v = Math.ceil(sMin / 2) * 2; v <= sMax; v += 2) st.push(v);
    drawChart('speed', { el: 'chartSpeed', label: 'Boat speed over the race', data: series.speed, yMin: sMin, yMax: () => sMax, yTicks: st, band: true, fmt: (v) => v.toFixed(1) + ' km/h' });
    const leg = selected().map((c) => `<span><i style="background:var(--${SLOT[slotOf(c)]})"></i>${esc(c.sail)} · ${esc(shortName(c))}</span>`).join('');
    $('legGap').innerHTML = leg + '<span><i style="background:var(--field)"></i>Rest of field</span>';
    $('legSpeed').innerHTML = leg + '<span><i style="background:var(--field-band);height:10px"></i>Middle half of field</span><span><i style="background:repeating-linear-gradient(90deg,var(--field) 0 4px,transparent 4px 7px)"></i>Field median</span>';
  }
  function moveCursor() {
    Object.values(charts).forEach((ch) => {
      const tx = ch.x(Math.max(0, Math.min(series.times[series.times.length - 1], state.t)));
      ch.cursor.setAttribute('x1', tx); ch.cursor.setAttribute('x2', tx);
      ch.cursor.setAttribute('visibility', state.t < 0 ? 'hidden' : 'visible');
    });
  }

  /* ---------- tooltip ---------- */
  const tip = $('tip');
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let lx = ev.clientX + 14, ly = ev.clientY + 14;
    if (lx + w > innerWidth - 8) lx = ev.clientX - w - 14;
    if (ly + h > innerHeight - 8) ly = ev.clientY - h - 14;
    tip.style.left = lx + 'px'; tip.style.top = ly + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  /* ---------- time + playback ---------- */
  function setTime(t) {
    state.t = Math.max(tMin, Math.min(tMax, t));
    $('slider').value = state.t;
    $('clockTime').textContent = clock(state.t);
    $('clockSub').textContent = state.t < 0 ? `Start in ${dur(-state.t)}` : `Race time ${dur(state.t, true)}`;
    updateBoats(); renderBoard(); moveCursor();
  }
  let last = null;
  function loop(ts) {
    if (!state.playing) return;
    if (last != null) {
      const nt = state.t + ((ts - last) / 1000) * state.speed;
      setTime(nt);
      if (nt >= tMax) { togglePlay(false); }
    }
    last = ts;
    requestAnimationFrame(loop);
  }
  function togglePlay(on) {
    state.playing = on == null ? !state.playing : on;
    if (state.playing && state.t >= tMax) setTime(tMin);
    $('playBtn').textContent = state.playing ? '❚❚' : '▶';
    $('playBtn').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    last = null;
    if (state.playing) requestAnimationFrame(loop);
  }

  /* ---------- re-render on selection change ---------- */
  function refreshAll() {
    writeURL(); syncSelectors();
    renderStats(); renderSplits(); renderResults();
    styleBoats(); buildSeries(); drawCharts(); setTime(state.t);
  }

  function bind() {
    $('focusSel').addEventListener('change', (e) => {
      state.focus = +e.target.value;
      state.cmp = state.cmp.map((x) => (x === state.focus ? null : x));
      refreshAll();
    });
    ['cmpSel1', 'cmpSel2'].forEach((id, k) => $(id).addEventListener('change', (e) => {
      const v = e.target.value ? +e.target.value : null;
      state.cmp[k] = v === state.focus ? null : v;
      if (state.cmp[0] != null && state.cmp[0] === state.cmp[1]) state.cmp[1 - k] = null;
      refreshAll();
    }));
    $('divSel').addEventListener('change', (e) => { state.div = e.target.value; refreshAll(); });
    $('slider').addEventListener('input', (e) => { if (state.playing) togglePlay(false); setTime(+e.target.value); });
    $('playBtn').addEventListener('click', () => togglePlay());
    $('speedSel').addEventListener('change', (e) => { state.speed = +e.target.value; });
    ['trailsChk', 'labelsChk', 'safetyChk'].forEach((id) => $(id).addEventListener('change', () => { styleBoats(); updateBoats(); }));
    $('satChk').addEventListener('change', setBase);
    $('lbBody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const b = boats[+tr.dataset.id]; if (b) { map.panTo(b.m.getLatLng()); b.m.openPopup(); b.m.setPopupContent(popupHtml(b.c)); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    });
    let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(drawCharts, 120); }).observe($('chartGap'));
  }

  fetch('data/race.json').then((r) => r.json()).then((data) => {
    R = data;
    const all = R.teams;
    crews = all.filter((c) => !c.safety && c.finish != null);
    safety = all.filter((c) => c.safety);
    byId = Object.fromEntries(all.map((c) => [c.id, c]));
    tMin = -15 * 60;
    tMax = Math.max(...crews.map((c) => c.finish)) + 10 * 60;
    $('courseKm').textContent = R.courseKm.toFixed(1);
    $('dateNote').textContent = R.dateNote;
    const sl = $('slider'); sl.min = tMin; sl.max = tMax; sl.step = 15;
    computeResults();
    fillSelectors();
    readURL();
    initMap();
    bind();
    refreshAll();
  }).catch((err) => {
    document.querySelector('main').insertAdjacentHTML('afterbegin', `<p class="card">Couldn't load the race data (${esc(err.message)}).</p>`);
  });
})();
