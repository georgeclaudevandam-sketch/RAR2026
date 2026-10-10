"""Replace YB's distance-to-finish with a jump-free progress measure.

Why: YB snaps each fix to the nearest point of its course line. The line doubles back in places (it runs 2 km into
Burgoyne Bay and out again, and around the beach gates), so YB's distance-to-finish jumps 1-2 km in a minute while a
boat rows 0.2 km. On the "distance behind the leader" chart that made every boat's gap step when the leader passed
those spots, and step back when the boat itself did.

How: every boat crosses the six gate lines in order, and those crossing times are known. Between two consecutive
crossings (start -> gate 1 -> ... -> gate 6 -> finish), progress is the share of that leg the boat has rowed along its
own track, scaled to the official course distance of the leg. It is smooth, never jumps, and is exact at every gate.
Track column 3 holds the course distance still to go, in metres (0 at and after the finish).
Safety launches keep YB's figure.
"""
import json
import math

import numpy as np

R = json.load(open('data/race.json'))
kx, ky = 111320 * math.cos(math.radians(48.8)), 110540
C = np.array([[n[1] * kx, n[0] * ky] for n in R['course']])
s_node = np.r_[0, np.cumsum(np.hypot(*np.diff(C, axis=0).T))]
L = float(s_node[-1])
gate_names = [g['name'] for g in R['gates'] if g['name'].startswith('Gate')]
# course distance at each gate = course node carrying that gate's name
s_gate = []
for gname in gate_names:
    num = gname.split(' - ')[0]                       # "Gate 1"
    k = next(i for i, n in enumerate(R['course']) if n[2] and n[2].startswith(num + ' '))
    s_gate.append(float(s_node[k]))

for c in R['teams']:
    if c['safety'] or c['finish'] is None or any(g not in c['splits'] for g in gate_names):
        continue
    tr = c['track']
    t = np.array([r[0] for r in tr], float)
    cum = np.array([r[4] for r in tr], float) * 1000          # metres rowed along the boat's own track
    rowed_at = lambda x: float(np.interp(x, t, cum))
    marks_t = [0.0] + [float(c['splits'][g]) for g in gate_names] + [float(c['finish'])]
    marks_s = [0.0] + s_gate + [L]
    marks_r = [rowed_at(x) for x in marks_t]
    for r in tr:
        if r[0] <= 0:
            r[3] = int(round(L)); continue
        if r[0] >= c['finish']:
            r[3] = 0; continue
        k = int(np.searchsorted(marks_t, r[0])) - 1
        k = max(0, min(k, len(marks_t) - 2))
        span = max(marks_r[k + 1] - marks_r[k], 1.0)
        f = min(1.0, max(0.0, (rowed_at(r[0]) - marks_r[k]) / span))
        r[3] = int(round(L - (marks_s[k] + f * (marks_s[k + 1] - marks_s[k]))))

R['progressNote'] = ('Distance to finish: each boat\'s progress between gate crossings follows the distance it rowed along '
                     'its own track, scaled to the official course distance of that leg, so it never jumps.')
json.dump(R, open('data/race.json', 'w'), separators=(',', ':'))
print(f'course {L / 1000:.2f} km; gates at', [round(s / 1000, 2) for s in s_gate])
