"""Find crew changes (and other stops) for every crew and store them in data/race.json.

Method: walk each track and flag stretches where the boat moves at less than half its own rowing speed
(time-weighted speed of the faster stretches within +/-25 min). The time lost in a stretch is
  elapsed time - distance covered / rowing speed,
so slowing down, landing, swapping and getting back up to speed all count. Stretches losing at least 60 s
are kept. A stop within 15 minutes of a beach gate is a crew change; the stretches around one gate are merged
into one change. Others are listed as "other stops". Start-line congestion (first 5 min) is ignored.

Checked against crew 204's 1-second log: YB-based estimates were within about +/-1 min per change and
0.9 min over the race.
"""
import json
import numpy as np

SLOW, MIN_LOSS, WIN, GATE_WIN, MERGE = 0.5, 60, 1500, 900, 1200


def dist_m(la1, lo1, la2, lo2):
    return np.hypot((la2 - la1) * 110540, (lo2 - lo1) * 111320 * np.cos(np.radians((la1 + la2) / 2)))


def detect(tr, fin, gates):
    A = np.array([[r[0], r[1], r[2]] for r in tr if -60 <= r[0] <= fin + 30], float)
    t = A[:, 0]; d = dist_m(A[:-1, 1], A[:-1, 2], A[1:, 1], A[1:, 2]); dt = np.diff(t)
    v = d / np.maximum(dt, 1); mid = (t[:-1] + t[1:]) / 2
    ev, i = [], 0
    while i < len(v):
        m = (np.abs(mid - mid[i]) < WIN) & (v > 1.2)
        ref = np.sum(v[m] * dt[m]) / max(np.sum(dt[m]), 1)
        if ref > 0 and v[i] < SLOW * ref and 300 < mid[i] < fin:
            j, lost = i, 0.0
            while j < len(v) and v[j] < SLOW * ref:
                lost += dt[j] - d[j] / ref; j += 1
            if lost >= MIN_LOSS:
                c = (t[i] + t[j]) / 2
                g = min(gates, key=lambda x: abs(x[1] - c)) if gates else None
                ev.append(dict(t0=int(t[i]), t1=int(t[j]), lost=float(lost), gate=g[0] if g and abs(g[1] - c) < GATE_WIN else None))
            i = j
        else:
            i += 1
    # one change per gate: merge nearby stretches attributed to the same gate
    out = []
    for e in ev:
        if out and e['gate'] and out[-1]['gate'] == e['gate'] and e['t0'] - out[-1]['t1'] < MERGE:
            out[-1]['t1'] = e['t1']; out[-1]['lost'] += e['lost']
        else:
            out.append(e)
    for e in out:
        e['lost'] = int(round(e['lost']))
        e['kind'] = 'change' if e['gate'] else 'stop'
    return out


R = json.load(open('data/race.json'))
G = [g for g in R['gates'] if g['name'].startswith('Gate')]
for c in R['teams']:
    if c['safety'] or c['finish'] is None:
        continue
    gates = [(g['short'], c['splits'][g['name']]) for g in G if g['name'] in c['splits']]
    ev = detect(c['track'], c['finish'], gates)
    if c['division'] == 'Solos':          # a single sculler has no crew to change: every stop is a stop
        for e in ev: e['kind'] = 'stop'
    c['changes'] = ev
    ch = [e for e in ev if e['kind'] == 'change']
    print(f"{c['sail']:>6} {len(ch)} changes {sum(e['lost'] for e in ch) / 60:5.1f} min, {len(ev) - len(ch)} other stops {sum(e['lost'] for e in ev if e['kind'] == 'stop') / 60:4.1f} min")
R['changesMethod'] = ('Stops are found from each track as time lost against the crew\'s own rowing speed nearby; a stop within '
                      '15 min of a beach gate counts as a crew change. From YB tracks the estimates are good to about ±1 min each '
                      '(checked against crew 204\'s 1-second log).')
json.dump(R, open('data/race.json', 'w'), separators=(',', ':'))
