"""Three-way comparison of crew 204's tracks: YB tracker, Niobium 1-s log, Maptattoo 10-s GPX.
Writes data/compare.json for compare.html.

Usage: python3 tools/compare_sources.py [path/to/yb-only/race.json]
  (needs data/raw/positions.json from tools/decode_yb_positions.py; the optional argument is a race.json built
   without tools/build_crew_detail.py, used to show how the site's numbers change with the crew's own data)
"""
import csv, json, math, re, sys
from datetime import datetime, timezone
import numpy as np

T0 = 1787493600
TEAM_ID = '4'          # YB id of crew 204


def ep(s):
    m = re.match(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?', s)
    return datetime.strptime(m.group(1), '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc).timestamp() + float(m.group(2) or 0)


def num(x):
    try:
        v = float(x); return v if math.isfinite(v) else np.nan
    except (TypeError, ValueError):
        return np.nan


def dist_m(la1, lo1, la2, lo2):
    return np.hypot((la2 - la1) * 110540, (lo2 - lo1) * 111320 * np.cos(np.radians((la1 + la2) / 2)))


def clock(t):
    t = int(round(t)); return f'{7 + t // 3600:02d}:{(t % 3600) // 60:02d}:{t % 60:02d}'


def r1(x, n=1):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), n)


# ---------------- load -----------------------------------------------------------------
rows = list(csv.DictReader(open('data/raw/crew204_niobium.csv', encoding='utf-8-sig')))
N = np.array([[ep(r['timestamp_utc']) - T0, num(r['lat']), num(r['lon']), num(r['speed_mps']), num(r['spm']),
               num(r['dist_per_stroke_m']), num(r['cum_distance_m']), num(r['heading_deg'])] for r in rows])
txt = open('data/raw/crew204_maptattoo.gpx', encoding='utf-8').read()
G = np.array([[ep(t) - T0, float(la), float(lo)] for la, lo, t in
              re.findall(r"<trkpt lat='([-\d.]+)' lon='([-\d.]+)'><time>([^<]+)</time>", txt)])
YBraw = np.array([[p['t'] - T0, p['lat'], p['lon']] for p in json.load(open('data/raw/positions.json'))[TEAM_ID]])
YBraw = YBraw[np.argsort(YBraw[:, 0], kind='stable')]
RACE = json.load(open('data/race.json'))
FIN = next(t for t in RACE['teams'] if t['sail'] == '204')['finish']
GATES = [g for g in RACE['gates'] if g['name'].startswith('Gate')]
FINLINE = next(g for g in RACE['gates'] if g['name'] == 'Finish')

# cleaned YB, same rule as tools/build_race_json.py
sys.argv_saved = sys.argv
src = open('tools/build_race_json.py').read()
ns = {'math': math}
exec(src[src.index('def hav('):src.index('def inter(')], ns)
exec(src[src.index('def clean(pts):'):src.index("gates=[]\nfor ln in S['poi']['lines']:")], ns)
cpts, dropped = ns['clean']([dict(t=r[0] + T0, lat=r[1], lon=r[2]) for r in YBraw])
YB = np.array([[p['t'] - T0, p['lat'], p['lon']] for p in cpts])
SRC = {'YB': YB, 'Niobium': N[:, :3], 'Maptattoo': G}
out = {'generated': datetime.now(timezone.utc).strftime('%Y-%m-%d'), 'finish': FIN}


def pos(A, t):
    return np.interp(t, A[:, 0], A[:, 1]), np.interp(t, A[:, 0], A[:, 2])


# ---------------- 1. coverage & sampling ---------------------------------------------
cov = []
for name, A in (('YB', YBraw), ('Niobium', N), ('Maptattoo', G)):
    dt = np.diff(A[:, 0]); race = (A[:-1, 0] >= 0) & (A[:-1, 0] <= FIN)
    d = dt[race]
    cov.append(dict(source=name, n=int(len(A)), first=clock(A[0, 0]), last=clock(A[-1, 0]),
                    interval=r1(np.median(d)), share_1s=r1(100 * np.mean(d <= 1.5)), share_10s=r1(100 * np.mean((d > 1.5) & (d <= 15))),
                    share_1min=r1(100 * np.mean((d > 15) & (d <= 90))), share_5min=r1(100 * np.mean(d > 90)),
                    gaps_over_2min=int((d > 120).sum()), longest_gap_s=r1(d.max(), 0),
                    fixes_per_hour=r1(race.sum() / (FIN / 3600), 0),
                    covers_start=bool(A[0, 0] <= 0), covers_finish=bool(A[-1, 0] >= FIN)))
out['coverage'] = cov

# ---------------- 2. clock alignment, hour by hour -------------------------------------
drift = []
for h in range(0, 10):
    w0, w1 = h * 3600 + 120, min((h + 1) * 3600, FIN - 30, N[-1, 0] - 5)
    if w1 - w0 < 600: continue
    ts = np.arange(w0, w1, 5.0); nla, nlo = pos(SRC['Niobium'], ts)
    row = {'hour': f'{7 + h:02d}:00'}
    for name in ('YB', 'Maptattoo'):
        A = SRC[name]; best = None
        for off in np.arange(-30, 30.5, 0.5):
            la, lo = pos(A, ts + off); e = np.median(dist_m(nla, nlo, la, lo))
            if best is None or e < best[0]: best = (e, off)
        row[name] = r1(best[1])
    drift.append(row)
out['clock'] = drift

# ---------------- 3. position agreement (reference: Niobium) ---------------------------
inrace = lambda A: A[(A[:, 0] > 60) & (A[:, 0] < min(FIN, N[-1, 0]) - 5)]
agree = []
pts_err = {}
for name, A in (('Maptattoo', G), ('YB (raw)', YBraw), ('YB (cleaned)', YB)):
    B = inrace(A); la, lo = pos(SRC['Niobium'], B[:, 0]); e = dist_m(la, lo, B[:, 1], B[:, 2])
    # split into along-track (timing-like) and cross-track components using Niobium's direction of travel
    la2, lo2 = pos(SRC['Niobium'], B[:, 0] + 5); la1, lo1 = pos(SRC['Niobium'], B[:, 0] - 5)
    tx = (lo2 - lo1) * 111320 * np.cos(np.radians(la)); ty = (la2 - la1) * 110540; tn = np.hypot(tx, ty)
    ex = (B[:, 2] - lo) * 111320 * np.cos(np.radians(la)); ey = (B[:, 1] - la) * 110540
    good = tn > 3
    along = np.abs((ex * tx + ey * ty)[good] / tn[good]); cross = np.abs((ex * ty - ey * tx)[good] / tn[good])
    agree.append(dict(source=name, n=int(len(B)), median=r1(np.median(e)), p90=r1(np.percentile(e, 90)), p99=r1(np.percentile(e, 99)),
                      max=r1(e.max(), 0), over25=r1(100 * np.mean(e > 25)), over100=r1(100 * np.mean(e > 100)),
                      along_median=r1(np.median(along)), cross_median=r1(np.median(cross))))
    pts_err[name] = [[int(t), r1(v)] for t, v in zip(B[:, 0], e)]
out['agreement'] = agree
out['error_series'] = {'YB (raw)': pts_err['YB (raw)'],
                       'Maptattoo': [[int(a), b] for a, b in pts_err['Maptattoo'][::6]]}
out['yb_dropped'] = [clock(t - T0) for t in dropped]
worst = sorted(pts_err['YB (raw)'], key=lambda x: -x[1])[:8]
out['yb_worst'] = []
for t, e in worst:
    la, lo = pos(SRC['Niobium'], np.array([t]))
    k = int(np.argmin(np.abs(YBraw[:, 0] - t)))
    out['yb_worst'].append(dict(time=clock(t), error_m=e, yb=[r1(YBraw[k, 1], 5), r1(YBraw[k, 2], 5)],
                                true=[r1(la[0], 5), r1(lo[0], 5)], removed=clock(t) in out['yb_dropped']))

# ---------------- 4. distance vs sampling interval -------------------------------------
tend = min(FIN, N[-1, 0])
def path_km(A, t0=0, t1=tend):
    B = A[(A[:, 0] >= t0) & (A[:, 0] <= t1)]
    return float(dist_m(B[:-1, 1], B[:-1, 2], B[1:, 1], B[1:, 2]).sum() / 1000)
samp = []
for s in (1, 2, 5, 10, 20, 30, 60, 120, 300, 600):
    ts = np.arange(0, tend, s); la, lo = pos(SRC['Niobium'], ts)
    samp.append([s, r1(path_km(np.c_[ts, la, lo]), 3)])
out['distance_vs_interval'] = samp
out['distance'] = {'window': f'07:00:00 → {clock(tend)} (end of the Niobium log)',
                   'Niobium positions': r1(path_km(SRC['Niobium']), 3), 'Niobium own odometer': r1((N[N[:, 0] <= tend, 6].max() - 0) / 1000, 3),
                   'Maptattoo': r1(path_km(G), 3), 'YB (raw)': r1(path_km(YBraw), 3), 'YB (cleaned)': r1(path_km(YB), 3)}

# ---------------- 5. speed agreement at several averaging windows ----------------------
def win_speed(A, t, w):
    m = (A[:, 0] >= t - w / 2) & (A[:, 0] <= t + w / 2); B = A[m]
    if len(B) < 2 or B[-1, 0] - B[0, 0] < 0.6 * w: return np.nan
    return dist_m(B[:-1, 1], B[:-1, 2], B[1:, 1], B[1:, 2]).sum() / (B[-1, 0] - B[0, 0])
spd = []
for w in (30, 60, 300):
    ts = np.arange(120, tend - 120, max(w, 30))
    dev = np.array([np.nanmean(N[(N[:, 0] >= t - w / 2) & (N[:, 0] <= t + w / 2), 3]) for t in ts])
    row = {'window_s': w}
    for name, A in (('Niobium positions', SRC['Niobium']), ('Maptattoo', G), ('YB (cleaned)', YB)):
        if name.startswith('YB') and w < 300:
            row[name] = None; continue
        v = np.array([win_speed(A, t, w) for t in ts]); ok = ~np.isnan(v) & ~np.isnan(dev) & (dev > 0.5)
        d = (v - dev)[ok]
        row[name] = dict(n=int(ok.sum()), bias=r1(d.mean(), 3), sd=r1(d.std(), 3), loa=[r1(d.mean() - 1.96 * d.std(), 2), r1(d.mean() + 1.96 * d.std(), 2)])
    spd.append(row)
out['speed'] = spd
# example window: speed trace through the Sunset Beach gate
ex0, ex1 = 3.9 * 3600, 4.5 * 3600
ts = np.arange(ex0, ex1, 10)
out['speed_example'] = {'from': clock(ex0), 'to': clock(ex1), 't': [int(t) for t in ts],
    'Niobium speed field': [r1(np.nanmean(N[(N[:, 0] >= t - 15) & (N[:, 0] < t + 15), 3]), 2) for t in ts],
    'Maptattoo': [r1(win_speed(G, t, 30), 2) for t in ts],
    }
yb_seg = []
B = YB[(YB[:, 0] >= ex0 - 600) & (YB[:, 0] <= ex1 + 600)]
for a, b in zip(B[:-1], B[1:]):
    if b[0] > a[0]:
        yb_seg.append([int(a[0]), int(b[0]), r1(dist_m(a[1], a[2], b[1], b[2]) / (b[0] - a[0]), 2)])
out['speed_example']['YB steps'] = yb_seg

# ---------------- 6. gate & finish timing ---------------------------------------------
def cross(A, g, tmin):
    (y3, x3), (y4, x4) = g['a'], g['b']
    for k in range(1, len(A)):
        if A[k, 0] < tmin: continue
        y1, x1, y2, x2 = A[k - 1, 1], A[k - 1, 2], A[k, 1], A[k, 2]
        den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if den == 0: continue
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den; u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den
        if 0 <= t <= 1 and 0 <= u <= 1: return A[k - 1, 0] + t * (A[k, 0] - A[k - 1, 0])
    return None
gates = []
prev = {k: 600 for k in SRC}
for g in GATES + [dict(FINLINE, short='Finish')]:
    row = {'gate': g.get('short', g['name'])}
    for name, A in SRC.items():
        tc = cross(A, g, prev[name] if g.get('short') != 'Finish' else 30000)
        row[name] = r1(tc, 1); prev[name] = (tc or prev[name]) + 60
    vals = [row[k] for k in SRC if row[k] is not None]
    row['spread_s'] = r1(max(vals) - min(vals), 1) if len(vals) > 1 else None
    gates.append(row)
out['gates'] = gates

# ---------------- 7. legs: distance and speed per source -------------------------------
bounds = [0] + [r['Maptattoo'] for r in gates[:-1]] + [FIN]
names = ['Start → ' + GATES[0]['short']] + [f"{a['short']} → {b['short']}" for a, b in zip(GATES, GATES[1:])] + [GATES[-1]['short'] + ' → Finish']
legs = []
for k, n in enumerate(names):
    t0, t1 = bounds[k], bounds[k + 1]
    row = {'leg': n, 'time': r1(t1 - t0, 0)}
    for name, A in SRC.items():
        if name == 'Niobium' and t1 > N[-1, 0]:
            row[name] = None; continue
        row[name] = r1(path_km(A, t0, t1), 3)
    legs.append(row)
out['legs'] = legs

# ---------------- 8. stops ---------------------------------------------------------------
def stops_from(ts, v, thr=0.5, minlen=30):
    out_, i = [], 0
    while i < len(v):
        if v[i] < thr:
            j = i
            while j < len(v) and v[j] < thr: j += 1
            if ts[j - 1] - ts[i] >= minlen: out_.append([int(ts[i]), int(ts[j - 1] - ts[i])])
            i = j
        else: i += 1
    return out_
tsN = N[(N[:, 0] >= 0) & (N[:, 0] <= tend)]
st_dev = stops_from(tsN[:, 0], tsN[:, 3])
tg = np.arange(0, tend, 10.0); vg = np.array([win_speed(G, t, 30) for t in tg])
st_map = stops_from(tg, np.nan_to_num(vg, nan=9))
out['stops'] = {'Niobium speed field': [[clock(a), b] for a, b in st_dev], 'Maptattoo positions': [[clock(a), b] for a, b in st_map],
                'total_s': {'Niobium speed field': sum(b for _, b in st_dev), 'Maptattoo positions': sum(b for _, b in st_map)},
                'YB': 'not resolvable: most YB fixes are 5 minutes apart'}

# ---------------- 9. heading & device fields --------------------------------------------
ts = np.arange(300, tend - 300, 60.0)
hd = []
for t in ts:
    la1, lo1 = pos(G, np.array([t - 30])); la2, lo2 = pos(G, np.array([t + 30]))
    dx = (lo2 - lo1)[0] * 111320 * math.cos(math.radians(la1[0])); dy = (la2 - la1)[0] * 110540
    if math.hypot(dx, dy) < 60: continue
    cog = (math.degrees(math.atan2(dx, dy)) + 360) % 360
    m = (N[:, 0] >= t - 30) & (N[:, 0] <= t + 30); h = N[m, 7]; h = h[~np.isnan(h)]
    if not len(h): continue
    mh = (math.degrees(math.atan2(np.sin(np.radians(h)).mean(), np.cos(np.radians(h)).mean())) + 360) % 360
    hd.append(abs((mh - cog + 180) % 360 - 180))
moving = N[(N[:, 3] > 1) & (N[:, 0] >= 0)]
spm_ok = ~np.isnan(moving[:, 4]) & (moving[:, 4] >= 5)
calc = moving[spm_ok, 3] * 60 / moving[spm_ok, 4]
dps_err = np.abs(calc - moving[spm_ok, 5])
uniq = np.unique(np.round(np.diff(np.unique(N[:, 3][~np.isnan(N[:, 3])])), 3))
out['device'] = {'heading_vs_course_median_deg': r1(np.median(hd)), 'heading_vs_course_p90_deg': r1(np.percentile(hd, 90)),
                 'speed_resolution_mps': r1(uniq.min(), 2) if len(uniq) else None,
                 'stroke_rate_missing_pct': r1(100 * (1 - spm_ok.mean())),
                 'dps_consistency_median_m': r1(np.median(dps_err), 3),
                 'odometer_vs_positions_pct': r1(100 * ((N[N[:, 0] <= tend, 6].max() / 1000) / path_km(SRC['Niobium']) - 1), 2)}

# ---------------- 10. what changes on the site ------------------------------------------
if len(sys.argv) > 1:
    A_ = json.load(open(sys.argv[1])); B_ = RACE
    a = next(t for t in A_['teams'] if t['sail'] == '204'); b = next(t for t in B_['teams'] if t['sail'] == '204')
    def metrics(c):
        tr = c['track']; fin = c['finish']
        r = [x for x in tr if 0 <= x[0] <= fin]
        km = r[-1][4] - r[0][4]
        sw = [(r[i][0] - r[i - 1][0], r[i][7]) for i in range(1, len(r)) if len(r[i]) > 7 and r[i][7] is not None]
        stw = sum(d * v for d, v in sw) / max(1, sum(d for d, _ in sw))
        gain = 0.0
        for i in range(1, len(r)):
            if len(r[i]) > 7 and r[i][6] and r[i][7] and r[i][6] > 2 and r[i][7] > 2:
                gain += (r[i][0] - r[i - 1][0]) * (r[i][6] / r[i][7] - 1)
        return dict(km=r1(km, 2), stw=r1(stw, 2), current_min=r1(gain / 60, 1), fixes=len(r), splits=c['splits'])
    ma, mb = metrics(a), metrics(b)
    out['impact'] = {'YB only': ma, 'Crew data': mb,
                     'split_diff_s': {k[:6] + ' ' + next(g['short'] for g in GATES if g['name'] == k): r1(mb['splits'].get(k, 0) - v, 0) for k, v in ma['splits'].items()}}

# ---------------- 11. tracks for the map ------------------------------------------------
Nn = N[(N[:, 0] >= 0) & (N[:, 0] <= tend)][::10]
Gg = G[(G[:, 0] >= 0) & (G[:, 0] <= FIN + 30)]
yb_err = {int(t): e for t, e in pts_err['YB (raw)']}
out['tracks'] = {'Niobium': [[r1(a, 5), r1(b, 5)] for a, b in Nn[:, 1:3]],
                 'Maptattoo': [[r1(a, 5), r1(b, 5)] for a, b in Gg[:, 1:3]],
                 'YB': [[r1(r[1], 5), r1(r[2], 5), clock(r[0]), yb_err.get(int(r[0]))] for r in YBraw if 0 <= r[0] <= FIN + 30]}
json.dump(out, open('data/compare.json', 'w'), separators=(',', ':'))
print(json.dumps({k: v for k, v in out.items() if k not in ('error_series', 'speed_example')}, indent=1)[:6000])
