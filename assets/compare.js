/* Track data comparison page: renders data/compare.json (built by tools/compare_sources.py). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const clock = (t) => { t = Math.round(t); return `${String(7 + Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const dur = (t) => { t = Math.round(t); return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const f = (v, n = 1, unit = '') => (v == null ? '–' : `${(+v).toFixed(n)}${unit}`);
  const table = (id, head, rows) => {
    $(id).innerHTML = '<thead><tr>' + head.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr>' + r.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('') + '</tr>').join('') + '</tbody>';
  };

  /* --- tiny SVG chart --- */
  const tip = $('tip');
  function chart(id, o) {
    const el = $(id), W = el.clientWidth, H = el.clientHeight, m = { l: 48, r: 14, t: 12, b: 28 };
    const X = (v) => m.l + ((o.xlog ? Math.log10(v) : v) - o.x0) / (o.x1 - o.x0) * (W - m.l - m.r);
    const Y = (v) => H - m.b - ((o.ylog ? Math.log10(v) : v) - o.y0) / (o.y1 - o.y0) * (H - m.t - m.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}">`;
    o.yt.forEach((v) => { s += `<g class="grid"><line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/></g><text x="${m.l - 6}" y="${Y(v) + 3.5}" text-anchor="end">${o.yf ? o.yf(v) : v}</text>`; });
    s += `<g class="axis"><line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/></g>`;
    o.xt.forEach((v) => { s += `<text x="${X(v)}" y="${H - 9}" text-anchor="middle">${o.xf ? o.xf(v) : v}</text>`; });
    if (o.ylab) s += `<text x="${m.l - 6}" y="9" text-anchor="end">${o.ylab}</text>`;
    s += o.body(X, Y);
    el.innerHTML = s + '</svg>';
    el.querySelectorAll('[data-tip]').forEach((n) => {
      n.addEventListener('mousemove', (ev) => { tip.innerHTML = n.dataset.tip; tip.hidden = false; tip.style.left = ev.clientX + 12 + 'px'; tip.style.top = ev.clientY + 12 + 'px'; });
      n.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
  }
  const line = (pts, X, Y, color, w = 2) => {
    let d = '', pen = false;
    pts.forEach(([x, y]) => { if (y == null || !isFinite(y)) { pen = false; return; } d += (pen ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(y).toFixed(1); pen = true; });
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round"/>`;
  };

  fetch('data/compare.json?v=26').then((r) => r.json()).then((C) => {
    const cov = Object.fromEntries(C.coverage.map((c) => [c.source, c]));
    const ag = Object.fromEntries(C.agreement.map((a) => [a.source, a]));
    const D = C.distance, gates = C.gates, fin = gates[gates.length - 1];
    const maxSpread = Math.max(...gates.map((g) => g.spread_s || 0));
    const sp5 = C.speed.find((s) => s.window_s === 300), sp60 = C.speed.find((s) => s.window_s === 60);
    const I = C.impact;

    /* findings */
    const F = [
      ['Clocks: all three agree', `Within ${Math.max(...C.clock.map((r) => Math.max(Math.abs(r.YB), Math.abs(r.Maptattoo)))).toFixed(1)} s all day. No time correction needed.`],
      ['Niobium and Maptattoo: near-identical', `Typically ${f(ag.Maptattoo.median)} m apart, never more than ${f(ag.Maptattoo.max, 0)} m. Two independent devices agreeing this closely means the crew's track can be trusted.`],
      ['YB: good, with a few bad fixes', `Usually within ${f(ag['YB (raw)'].median)} m, but ${f(ag['YB (raw)'].over100)}% of fixes were over 100 m off, the worst ${f(ag['YB (raw)'].max, 0)} m (Sansum Narrows, 09:50).`],
      ['Gate times: all agree', `Every gate within ${maxSpread.toFixed(1)} s across the three sources. The leaderboard's gate splits are solid.`],
      ['Distance depends on sampling', `Crew devices: ${f(D['Niobium positions'], 2)} / ${f(D.Maptattoo, 2)} km. YB's 5-minute gaps cut corners (${f(D['YB (cleaned)'], 2)} km once bad fixes are removed).`],
      ['Speed: crew devices agree to 0.1 km/h', `Over 1-minute windows, Maptattoo matches the Niobium speed reading with a bias of ${f(sp60.Maptattoo.bias * 3.6, 2)} km/h. YB can only resolve 5-minute averages (±${f(1.96 * sp5['YB (cleaned)'].sd * 3.6, 1)} km/h).`],
    ];
    $('findings').innerHTML = F.map(([h, t]) => `<div class="finding"><b>${h}</b>${t}</div>`).join('');

    table('tCoverage', ['Source', 'Points', 'From', 'To', 'Typical interval', 'Fixes per hour', 'Gaps over 2 min', 'Longest gap', 'Covers start / finish'],
      C.coverage.map((c) => [c.source, c.n.toLocaleString(), c.first, c.last, c.source === 'YB' ? `1 min (${f(c.share_1min, 0)}%) / 5 min (${f(c.share_5min, 0)}%)` : `${c.interval} s`,
        c.fixes_per_hour, c.gaps_over_2min, `${c.longest_gap_s} s`, `${c.covers_start ? 'yes' : '<span class="warn">no</span> (starts ' + c.first + ')'} / ${c.covers_finish ? 'yes' : '<span class="warn">no</span> (ends ' + c.last + ')'}`]));
    table('tClock', ['Hour', 'YB offset (s)', 'Maptattoo offset (s)'], C.clock.map((r) => [r.hour, f(r.YB), f(r.Maptattoo)]));
    table('tAgree', ['Source vs Niobium', 'Fixes', 'Median', '90% within', '99% within', 'Worst', 'Over 25 m', 'Over 100 m', 'Median along / across'],
      C.agreement.map((a) => [a.source, a.n, f(a.median, 1, ' m'), f(a.p90, 1, ' m'), f(a.p99, 0, ' m'), f(a.max, 0, ' m'), f(a.over25, 1, '%'), f(a.over100, 1, '%'), `${f(a.along_median)} / ${f(a.cross_median)} m`]));
    table('tWorst', ['YB fix', 'Error', 'YB position', 'True position', 'Removed on the site?'],
      C.yb_worst.map((w) => [w.time, f(w.error_m, 0, ' m'), w.yb.join(', '), w.true.join(', '), w.removed ? 'yes' : 'no (subtle: needs a crew track to spot)']));

    /* error chart (log) */
    const E = C.error_series['YB (raw)'], M = C.error_series.Maptattoo, drop = new Set(C.yb_dropped);
    chart('cErr', { label: 'Position error through the race', x0: 0, x1: C.finish, ylog: true, y0: 0, y1: 3, yt: [1, 10, 100, 1000], yf: (v) => v + ' m', xt: [0, 3600, 7200, 10800, 14400, 18000, 21600, 25200, 28800, 32400], xf: (v) => clock(v).slice(0, 5),
      body: (X, Y) => line(M.map(([t, e]) => [t, Math.max(1, e)]), X, Y, 'var(--map)', 1.5) +
        E.map(([t, e]) => `<circle cx="${X(t).toFixed(1)}" cy="${Y(Math.max(1, e)).toFixed(1)}" r="${drop.has(clock(t)) ? 6 : 3.5}" fill="var(--yb)" ${drop.has(clock(t)) ? 'stroke="var(--ink)" stroke-width="1.5"' : 'stroke="var(--surface)" stroke-width="1"'} data-tip="<b>${clock(t)}</b><br>YB ${e} m from the crew's track"/>`).join('') });

    /* distance vs interval */
    const DV = C.distance_vs_interval;
    const dmin = Math.floor(Math.min(...DV.map((d) => d[1]), D['YB (cleaned)']) - 0.5), dmax = Math.ceil(Math.max(...DV.map((d) => d[1]), D['YB (raw)']) + 0.3);
    const ybInt = 60 * 1.6;   // YB effective spacing in this window (mix of 1- and 5-minute fixes)
    chart('cDist', { label: 'Distance versus sampling interval', xlog: true, x0: 0, x1: Math.log10(600), y0: dmin, y1: dmax, yt: Array.from({ length: dmax - dmin + 1 }, (_, i) => dmin + i), yf: (v) => v + ' km',
      xt: [1, 10, 60, 300, 600], xf: (v) => (v < 60 ? v + ' s' : v / 60 + ' min'),
      body: (X, Y) => line(DV, X, Y, 'var(--nio)') + DV.map(([s, d]) => `<circle cx="${X(s)}" cy="${Y(d)}" r="3.5" fill="var(--nio)" data-tip="Every ${s < 60 ? s + ' s' : s / 60 + ' min'}: ${d.toFixed(2)} km"/>`).join('') +
        `<circle cx="${X(10)}" cy="${Y(D.Maptattoo)}" r="6" fill="var(--map)" stroke="var(--surface)" stroke-width="2" data-tip="Maptattoo (10 s): ${D.Maptattoo.toFixed(2)} km"/>` +
        `<circle cx="${X(ybInt)}" cy="${Y(D['YB (raw)'])}" r="6" fill="none" stroke="var(--yb)" stroke-width="2.5" data-tip="YB raw: ${D['YB (raw)'].toFixed(2)} km (bad fixes add zig-zags)"/>` +
        `<circle cx="${X(ybInt)}" cy="${Y(D['YB (cleaned)'])}" r="6" fill="var(--yb)" stroke="var(--surface)" stroke-width="2" data-tip="YB cleaned: ${D['YB (cleaned)'].toFixed(2)} km"/>` +
        `<text x="${X(ybInt) + 10}" y="${Y(D['YB (raw)']) + 4}" style="fill:var(--ink-2)">YB raw</text><text x="${X(ybInt) + 10}" y="${Y(D['YB (cleaned)']) + 4}" style="fill:var(--ink-2)">YB cleaned</text><text x="${X(10) + 10}" y="${Y(D.Maptattoo) - 8}" style="fill:var(--ink-2)">Maptattoo</text>` });
    table('tDist', ['Measure', 'Distance'], [['Window', D.window], ['Niobium positions (1 s)', f(D['Niobium positions'], 2, ' km')], ['Niobium own odometer', f(D['Niobium own odometer'], 2, ' km')],
      ['Maptattoo (10 s)', f(D.Maptattoo, 2, ' km')], ['YB raw', f(D['YB (raw)'], 2, ' km')], ['YB with bad fixes removed', f(D['YB (cleaned)'], 2, ' km')]]);

    table('tGates', ['Gate', 'YB', 'Niobium', 'Maptattoo', 'Spread'], gates.map((g) => [g.gate, g.YB == null ? '–' : clock(g.YB), g.Niobium == null ? '<span class="muted">log ended</span>' : clock(g.Niobium), g.Maptattoo == null ? '–' : clock(g.Maptattoo), g.spread_s == null ? '–' : f(g.spread_s, 1, ' s')]));
    table('tLegs', ['Leg', 'Leg time', 'YB', 'Niobium', 'Maptattoo', 'YB short by'], C.legs.map((l) => {
      const ref = l.Niobium ?? l.Maptattoo;
      return [l.leg, dur(l.time), f(l.YB, 2, ' km'), l.Niobium == null ? '<span class="muted">log ended</span>' : f(l.Niobium, 2, ' km'), f(l.Maptattoo, 2, ' km'), f((ref - l.YB) * 1000, 0, ' m')];
    }));
    table('tSpeed', ['Averaging window', 'Niobium positions vs reading', 'Maptattoo vs Niobium reading', 'YB vs Niobium reading'], C.speed.map((s) => [
      s.window_s < 60 ? `${s.window_s} s` : `${s.window_s / 60} min`,
      ...['Niobium positions', 'Maptattoo', 'YB (cleaned)'].map((k) => (s[k] && s[k].n ? `${s[k].bias >= 0 ? '+' : '−'}${Math.abs(s[k].bias * 3.6).toFixed(2)} km/h <small class="sub">95% within ${(s[k].loa[0] * 3.6).toFixed(2)} to +${(s[k].loa[1] * 3.6).toFixed(2)}</small>` : '<span class="muted">not possible (too few fixes)</span>'))]));

    /* speed example */
    const X0 = C.speed_example.t[0], X1 = C.speed_example.t[C.speed_example.t.length - 1];
    $('exTitle').textContent = `Example: speed ${C.speed_example.from.slice(0, 5)}–${C.speed_example.to.slice(0, 5)}, through Sunset Beach`;
    const xt = []; for (let t = Math.ceil(X0 / 600) * 600; t <= X1; t += 600) xt.push(t);
    chart('cSpeed', { label: 'Speed through the Sunset Beach gate', x0: X0, x1: X1, y0: 0, y1: 14, yt: [0, 2, 4, 6, 8, 10, 12, 14], ylab: 'km/h', xt, xf: (v) => clock(v).slice(0, 5),
      body: (X, Y) => {
        const k = (a) => a.map((v, i) => [C.speed_example.t[i], v == null ? null : v * 3.6]);
        let s = line(k(C.speed_example.Maptattoo), X, Y, 'var(--map)', 1.5) + line(k(C.speed_example['Niobium speed field']), X, Y, 'var(--nio)', 2);
        C.speed_example['YB steps'].forEach(([a, b, v]) => {
          const a2 = Math.max(a, X0), b2 = Math.min(b, X1); if (b2 <= a2) return;
          s += `<line x1="${X(a2)}" x2="${X(b2)}" y1="${Y(v * 3.6)}" y2="${Y(v * 3.6)}" stroke="var(--yb)" stroke-width="3" data-tip="YB ${clock(a).slice(0, 5)}–${clock(b).slice(0, 5)}: ${(v * 3.6).toFixed(1)} km/h"/>`;
        });
        return s;
      } });

    /* stops */
    const sN = C.stops['Niobium speed field'], sM = C.stops['Maptattoo positions'];
    const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const rowsS = sN.map(([t, d]) => { const m = sM.find(([u]) => Math.abs(clockSec(u) - clockSec(t)) < 60); return [t, mmss(d), m ? mmss(m[1]) : '<span class="muted">not detected</span>', '–']; });
    function clockSec(c) { const [h, m, s] = c.split(':').map(Number); return (h - 7) * 3600 + m * 60 + s; }
    rowsS.push(['<b>Total</b>', `<b>${mmss(C.stops.total_s['Niobium speed field'])}</b>`, `<b>${mmss(C.stops.total_s['Maptattoo positions'])}</b>`, '<span class="muted">can\'t resolve</span>']);
    table('tStops', ['Stopped at', 'Niobium', 'Maptattoo', 'YB'], rowsS);
    const Dv = C.device;
    table('tDevice', ['Check', 'Result'], [
      ['Niobium heading vs course over the ground (Maptattoo)', `median ${f(Dv.heading_vs_course_median_deg)}°, 90% within ${f(Dv.heading_vs_course_p90_deg)}°`],
      ['Speed reading resolution', `${f(Dv.speed_resolution_mps, 1)} m/s (${f(Dv.speed_resolution_mps * 3.6, 2)} km/h)`],
      ['Distance per stroke = speed × 60 ÷ rate', `consistent (median difference ${f(Dv.dps_consistency_median_m * 100, 1)} cm)`],
      ['Odometer vs distance from positions', `${f(Dv.odometer_vs_positions_pct, 2)}% longer`],
      ['Stroke rate missing while rowing', `${f(Dv.stroke_rate_missing_pct, 0)}% of the time (short dropouts)`],
      ['Log start / end', `starts ${cov.Niobium.first}, ends ${cov.Niobium.last}, 18 s before the finish line`]]);

    if (I) {
      const a = I['YB only'], b = I['Crew data'];
      table('tImpact', ['Measure', 'YB only', 'Crew recordings', 'Difference'], [
        ['Positions used, start to finish', a.fixes, b.fixes.toLocaleString(), ''],
        ['Distance rowed', f(a.km, 2, ' km'), f(b.km, 2, ' km'), f(b.km - a.km, 2, ' km')],
        ['Average speed through the water', f(a.stw, 2, ' km/h'), f(b.stw, 2, ' km/h'), f(b.stw - a.stw, 2, ' km/h')],
        ['Effect of the current', f(a.current_min, 1, ' min'), f(b.current_min, 1, ' min'), f(b.current_min - a.current_min, 1, ' min')],
        ['Gate times', 'from YB', 'from Niobium', `within ${Math.max(...Object.values(I.split_diff_s).map(Math.abs))} s`]]);
    }

    /* map */
    const map = L.map('cmpMap');
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }).addTo(map);
    L.polyline(C.tracks.Maptattoo, { color: css('--map'), weight: 4, opacity: 0.9 }).addTo(map);
    L.polyline(C.tracks.Niobium, { color: css('--nio'), weight: 2, opacity: 1 }).addTo(map);
    L.polyline(C.tracks.YB.map((p) => [p[0], p[1]]), { color: css('--yb'), weight: 1.5, opacity: 0.8, dashArray: '4 4' }).addTo(map);
    C.tracks.YB.forEach(([la, lo, t, e]) => {
      if (e == null) return;
      L.circleMarker([la, lo], { radius: e > 60 ? 7 : 3, color: '#fff', weight: 1, fillColor: css('--yb'), fillOpacity: 1 }).bindTooltip(`YB ${t}: ${e} m off`).addTo(map);
    });
    const lg = L.control({ position: 'topright' });
    lg.onAdd = () => { const d = L.DomUtil.create('div', 'curlegend'); d.innerHTML = `<div class="key"><i style="background:${css('--nio')}"></i>Niobium<br><i style="background:${css('--map')}"></i>Maptattoo<br><i style="background:${css('--yb')}"></i>YB fixes</div>`; return d; };
    lg.addTo(map);
    map.fitBounds([[48.796, -123.566], [48.815, -123.545]]);
  }).catch((e) => { console.error(e); document.querySelector('main').insertAdjacentHTML('afterbegin', `<p class="card">Couldn't load the comparison (${esc(e.message)}).</p>`); });
})();
