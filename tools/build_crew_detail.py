"""Replace a crew's YB track with its own detailed recordings, and add stroke data.

Crew 204 (Team Oar Deal):
  data/raw/crew204_niobium.csv     1-second log: position, speed, stroke rate, distance per stroke (primary)
  data/raw/crew204_maptattoo.gpx   10-second GPS track (fills the last seconds after the Niobium log ends)
The official finish time stays the YB/leaderboard one.

Track rows keep the site's format [t, lat, lon, distance-to-finish m, cumulative km, 5-min speed km/h], sampled
every 10 s; distance-to-finish is interpolated from the (cleaned) YB fixes. Stroke data is stored separately as
'detail': {'rows': [[t, speed m/s, stroke rate spm, distance per stroke m], ...]} every 10 s (30-s averages).
"""
import csv, json, math, re
from datetime import datetime, timezone
import numpy as np

T0 = 1787493600
SAIL = '204'
STEP = 10


def ep(s):
    m = re.match(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?', s)
    return datetime.strptime(m.group(1), '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc).timestamp() + float(m.group(2) or 0)


def num(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else np.nan
    except (TypeError, ValueError):
        return np.nan


def dist_m(la1, lo1, la2, lo2):
    return np.hypot((la2 - la1) * 110540, (lo2 - lo1) * 111320 * np.cos(np.radians((la1 + la2) / 2)))


rows = list(csv.DictReader(open('data/raw/crew204_niobium.csv', encoding='utf-8-sig')))
N = np.array([[ep(r['timestamp_utc']) - T0, num(r['lat']), num(r['lon']), num(r['speed_mps']), num(r['spm']),
               num(r['dist_per_stroke_m'])] for r in rows])
N = N[~np.isnan(N[:, 1])]
txt = open('data/raw/crew204_maptattoo.gpx', encoding='utf-8').read()
G = np.array([[ep(t) - T0, float(la), float(lo)] for la, lo, t in
              re.findall(r"<trkpt lat='([-\d.]+)' lon='([-\d.]+)'><time>([^<]+)</time>", txt)])

R = json.load(open('data/race.json'))
c = next(t for t in R['teams'] if t['sail'] == SAIL)
yb = np.array([[r[0], r[3] if r[3] is not None else np.nan] for r in c['track']])

# merged position series: Maptattoo before the Niobium log starts and after it ends, Niobium in between
pre = G[G[:, 0] < N[0, 0]]
post = G[G[:, 0] > N[-1, 0]]
P = np.vstack([pre[:, :3], N[:, :3], post[:, :3]])
ts = np.arange(math.ceil(P[0, 0] / STEP) * STEP, P[-1, 0], STEP)
lat = np.interp(ts, P[:, 0], P[:, 1]); lon = np.interp(ts, P[:, 0], P[:, 2])
seg = np.r_[0, dist_m(lat[:-1], lon[:-1], lat[1:], lon[1:])]
seg[seg < 0.8] = 0          # ignore GPS jitter while stopped (< 0.3 km/h over 10 s)
cum = np.cumsum(seg) / 1000
ok = ~np.isnan(yb[:, 1])
dtf = np.interp(ts, yb[ok, 0], yb[ok, 1])
k = max(1, 300 // STEP)
spd = [None if i < 6 else round((cum[i] - cum[max(0, i - k)]) / ((ts[i] - ts[max(0, i - k)]) / 3600), 2) for i in range(len(ts))]
fin = c['finish']
track = []
for i, t in enumerate(ts):
    d = 0 if fin is not None and t >= fin else int(round(dtf[i]))
    track.append([int(t), round(float(lat[i]), 6), round(float(lon[i]), 6), d, round(float(cum[i]), 3), spd[i]])
c['track'] = track
c['trackKm'] = round(float(cum[-1]), 2)
c['source'] = 'Crew recordings: Niobium 1-s log, Maptattoo GPX for the last seconds to the line; finish time from YB.'


# gate crossings from the detailed track (same method as the YB tracks)
def inter(p1, p2, q1, q2):
    (y1, x1), (y2, x2), (y3, x3), (y4, x4) = p1, p2, q1, q2
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if den == 0: return None
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den
    return t if 0 <= t <= 1 and 0 <= u <= 1 else None


splits = {}
for g in [g for g in R['gates'] if g['name'].startswith('Gate')]:
    for i in range(1, len(P)):
        if P[i, 0] < 0: continue
        f = inter((P[i - 1, 1], P[i - 1, 2]), (P[i, 1], P[i, 2]), g['a'], g['b'])
        if f is not None:
            splits[g['name']] = round(P[i - 1, 0] + f * (P[i, 0] - P[i - 1, 0])); break
c['splits'] = splits

# stroke data, 30-s centred averages every 10 s, while the Niobium log runs
det = []
for t in np.arange(math.ceil(N[0, 0] / STEP) * STEP, N[-1, 0], STEP):
    m = (N[:, 0] >= t - 15) & (N[:, 0] < t + 15)
    if not m.any(): continue
    v, r_, d = np.nanmean(N[m, 3]), np.nanmean(N[m, 4]) if (~np.isnan(N[m, 4])).any() else np.nan, \
        np.nanmean(N[m, 5]) if (~np.isnan(N[m, 5])).any() else np.nan
    rate = None if np.isnan(r_) or r_ < 5 or v < 0.5 else round(float(r_), 1)
    det.append([int(t), round(float(v), 2), rate, None if rate is None or np.isnan(d) else round(float(d), 2)])
c['detail'] = {'source': 'Niobium log (1 s), averaged over 30 s', 'rows': det}
json.dump(R, open('data/race.json', 'w'), separators=(',', ':'))
print(f'{SAIL}: {len(track)} track rows, {c["trackKm"]} km, splits', {k[:6]: v for k, v in splits.items()}, '| detail rows', len(det))
