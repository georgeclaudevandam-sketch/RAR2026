"""Add SalishSeaCast surface currents to the site.

Inputs (CSV downloads from the SalishSeaCast ERDDAP server, https://salishsea.eos.ubc.ca/erddap):
  data/raw/ssc_box_grid.csv   longitude, latitude, bathymetry for the model cells around Salt Spring
                              (ubcSSnBathymetryV21-08, full resolution, the gridY/gridX box below)
  data/raw/ssc_box_u.csv      uVelocity at the surface (ubcSSg3DuGridFields1hV21-11, same box, hourly)
  data/raw/ssc_box_v.csv      vVelocity at the surface (ubcSSg3DvGridFields1hV21-11, same box, hourly)

Outputs:
  data/currents.json          hourly surface currents resampled to a regular lat/lon grid, for the map animation
  data/race.json              each track row gains [.., sogKmh, stwKmh, currentAlongKmh, currentKmh]

Model velocities are on NEMO's rotated, staggered C-grid: u sits on the east face of each cell and v on the
north face, both along the grid axes. We average them to the cell centre and rotate to east/north using the
local grid angle computed from the cell coordinates.

Usage: python3 tools/build_currents.py
The race ran on Sunday 23 Aug 2026; the start (07:00 PDT) is 14:00 UTC, as in the YB timestamps.
"""
import csv, json, math, os, sys
from datetime import datetime, timezone
import numpy as np
from scipy.spatial import cKDTree

T0 = 1787493600                         # 07:00 PDT Sunday 23 Aug 2026 = 14:00 UTC (YB start time)
GRID = dict(lat0=48.680, lat1=48.985, lon0=-123.680, lon1=-123.290, dlat=0.0035, dlon=0.005)


def read_erddap(path, var):
    """ERDDAP griddap CSV: header row, units row, then rows of axes + variables."""
    with open(path, encoding='utf-8-sig') as f:
        r = csv.reader(f)
        head = next(r); next(r)
        idx = {h: i for i, h in enumerate(head)}
        out = []
        for row in r:
            if not row:
                continue
            out.append(row)
    return head, idx, out


def flt(s):
    try:
        v = float(s)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


# ---- grid geometry ------------------------------------------------------------
head, idx, rows = read_erddap('data/raw/ssc_box_grid.csv', None)
ys = sorted({int(float(r[idx['gridY']])) for r in rows})
xs = sorted({int(float(r[idx['gridX']])) for r in rows})
y0, x0 = ys[0], xs[0]
NY, NX = len(ys), len(xs)
LON = np.full((NY, NX), np.nan); LAT = np.full((NY, NX), np.nan); DEP = np.full((NY, NX), np.nan)
for r in rows:
    j, i = int(float(r[idx['gridY']])) - y0, int(float(r[idx['gridX']])) - x0
    LON[j, i] = flt(r[idx['longitude']]); LAT[j, i] = flt(r[idx['latitude']])
    b = flt(r[idx['bathymetry']]) if 'bathymetry' in idx else None
    DEP[j, i] = b if b is not None else np.nan
WATER = np.isfinite(DEP) & (DEP > 0)

# local angle of the +gridX axis, radians CCW from east
coslat = np.cos(np.radians(np.nanmean(LAT)))
dx_e = np.gradient(LON, axis=1) * coslat
dx_n = np.gradient(LAT, axis=1)
ANG = np.arctan2(dx_n, dx_e)
print(f'grid box y {y0}-{ys[-1]}, x {x0}-{xs[-1]}; water cells {WATER.sum()}; grid angle ~{np.degrees(np.nanmedian(ANG)):.1f} deg')


def load_vel(path, var):
    head, idx, rows = read_erddap(path, var)
    times = sorted({r[idx['time']] for r in rows})
    T = {t: k for k, t in enumerate(times)}
    A = np.zeros((len(times), NY, NX))
    for r in rows:
        j, i = int(float(r[idx['gridY']])) - y0, int(float(r[idx['gridX']])) - x0
        if 0 <= j < NY and 0 <= i < NX:
            v = flt(r[idx[var]])
            A[T[r[idx['time']]], j, i] = v if v is not None else 0.0
    return times, A


tu, U = load_vel('data/raw/ssc_box_u.csv', 'uVelocity')
tv, V = load_vel('data/raw/ssc_box_v.csv', 'vVelocity')
assert tu == tv, 'u and v files cover different times'
# unstagger to cell centres
Uc = U.copy(); Uc[:, :, 1:] = 0.5 * (U[:, :, 1:] + U[:, :, :-1])
Vc = V.copy(); Vc[:, 1:, :] = 0.5 * (V[:, 1:, :] + V[:, :-1, :])
# rotate grid-relative -> east/north (m/s)
UE = Uc * np.cos(ANG) - Vc * np.sin(ANG)
VN = Uc * np.sin(ANG) + Vc * np.cos(ANG)
UE[:, ~WATER] = 0; VN[:, ~WATER] = 0

epochs = [datetime.strptime(t.replace('Z', ''), '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc).timestamp() for t in tu]
# The model ran about an hour late on this course vs. race-day observations (south shore against at 07:00,
# northward push up the west side after rounding), so by default model time t+60 min is shown at race time t.
SHIFT = int(float(os.environ.get('CURRENT_SHIFT_MIN', '60')) * 60)  # model runs late by this much: model time t+SHIFT is shown at race time t
tsec = [int(e - T0) - SHIFT for e in epochs]
print('hours in file:', len(tsec), 'from', tu[0], 'to', tu[-1], '-> race seconds', tsec[0], '..', tsec[-1])
keep = [k for k, t in enumerate(tsec) if -2 * 3600 <= t <= 11 * 3600]
assert keep, f'No current data during the race. Times in file: {tu[0]} .. {tu[-1]}'

# ---- resample to a regular lat/lon grid ------------------------------------------
glat = np.arange(GRID['lat0'], GRID['lat1'] + 1e-9, GRID['dlat'])
glon = np.arange(GRID['lon0'], GRID['lon1'] + 1e-9, GRID['dlon'])
PX = lambda lon, lat: np.c_[(lon + 123.5) * 111320 * coslat, (lat - 48.8) * 110540]
wj, wi = np.where(WATER)
tree = cKDTree(PX(LON[wj, wi], LAT[wj, wi]))
GLON, GLAT = np.meshgrid(glon, glat)
dist, nn = tree.query(PX(GLON.ravel(), GLAT.ravel()), k=4)
w = 1 / np.maximum(dist, 1.0) ** 2
w /= w.sum(axis=1, keepdims=True)
mask = (dist[:, 0] < 320).reshape(GLAT.shape)    # regular cell is water if a model water cell is close

frames_u, frames_v = [], []
for k in keep:
    ue = (UE[k][wj, wi][nn] * w).sum(axis=1).reshape(GLAT.shape)
    vn = (VN[k][wj, wi][nn] * w).sum(axis=1).reshape(GLAT.shape)
    frames_u.append(ue); frames_v.append(vn)
FU = np.array(frames_u); FV = np.array(frames_v); FT = np.array([tsec[k] for k in keep], dtype=float)

cur = {
    'source': 'SalishSeaCast (UBC) hourly surface currents, model run V21-11, top layer (0.5 m), '
              'for Sunday 23 August 2026' + (f', shifted {SHIFT // 60} min earlier to match race-day observations' if SHIFT else '') + '.',
    'grid': {'lat0': float(glat[0]), 'lon0': float(glon[0]), 'dlat': GRID['dlat'], 'dlon': GRID['dlon'],
             'nLat': len(glat), 'nLon': len(glon)},
    'times': [int(t) for t in FT],
    'mask': ''.join('1' if m else '0' for m in mask.ravel()),
    # cm/s integers, row-major from the south-west corner; land cells hold 0
    'u': [[int(round(v * 100)) if m else 0 for v, m in zip(f.ravel(), mask.ravel())] for f in FU],
    'v': [[int(round(v * 100)) if m else 0 for v, m in zip(f.ravel(), mask.ravel())] for f in FV],
}
json.dump(cur, open('data/currents.json', 'w'), separators=(',', ':'))
mx = np.sqrt(FU ** 2 + FV ** 2)[:, mask].max()
print(f'currents.json: {len(glat)}x{len(glon)} grid, {len(FT)} hours, max {mx:.2f} m/s ({mx * 1.94384:.1f} kn)')


# ---- current at boats; speed over ground vs through the water ----------------------
def field_at(lat, lon, t):
    """east/north current (m/s) at a point, bilinear in space (filled near shore) and linear in time."""
    fy = (lat - glat[0]) / GRID['dlat']; fx = (lon - glon[0]) / GRID['dlon']
    j = int(np.clip(np.floor(fy), 0, len(glat) - 2)); i = int(np.clip(np.floor(fx), 0, len(glon) - 2))
    ay, ax = np.clip(fy - j, 0, 1), np.clip(fx - i, 0, 1)
    k = int(np.clip(np.searchsorted(FT, t) - 1, 0, len(FT) - 2)) if len(FT) > 1 else 0
    at = np.clip((t - FT[k]) / (FT[k + 1] - FT[k]), 0, 1) if len(FT) > 1 else 0.0
    out = []
    for F in (FU, FV):
        vals = []
        for kk, wt in ((k, 1 - at), (min(k + 1, len(FT) - 1), at)):
            c = [(j, i, (1 - ay) * (1 - ax)), (j, i + 1, (1 - ay) * ax), (j + 1, i, ay * (1 - ax)), (j + 1, i + 1, ay * ax)]
            num = sum(F[kk, a, b] * ww for a, b, ww in c if mask[a, b]); den = sum(ww for a, b, ww in c if mask[a, b])
            if den == 0:  # all four cells are land: use nearest water cell
                _, n1 = tree.query(PX(np.array([lon]), np.array([lat])))
                jj, ii = wj[n1[0]], wi[n1[0]]
                v = UE[keep[kk]][jj, ii] if F is FU else VN[keep[kk]][jj, ii]
            else:
                v = num / den
            vals.append(v * wt)
        out.append(sum(vals))
    return out


R = json.load(open('data/race.json'))
for c in R['teams']:
    tr = c['track']
    n = len(tr)
    # ground velocity, centred ~5-minute window
    for a in range(n):
        lo = a; hi = a
        while lo > 0 and tr[a][0] - tr[lo - 1][0] <= 150: lo -= 1
        while hi < n - 1 and tr[hi + 1][0] - tr[a][0] <= 150: hi += 1
        # positions are logged every 1-5 minutes; make sure the window reaches at least one neighbour each side
        if lo == a and a > 0 and tr[a][0] - tr[a - 1][0] <= 660: lo = a - 1
        if hi == a and a < n - 1 and tr[a + 1][0] - tr[a][0] <= 660: hi = a + 1
        dt = tr[hi][0] - tr[lo][0]
        row = tr[a][:6]
        if dt < 60:
            tr[a] = row + [None, None, None, None]
            continue
        lat_m = math.radians((tr[hi][1] + tr[lo][1]) / 2)
        ve = (tr[hi][2] - tr[lo][2]) * 111320 * math.cos(lat_m) / dt
        vn = (tr[hi][1] - tr[lo][1]) * 110540 / dt
        ce, cn = field_at(tr[a][1], tr[a][2], tr[a][0])
        sog = math.hypot(ve, vn)
        stw = math.hypot(ve - ce, vn - cn)
        along = (ce * ve + cn * vn) / sog if sog > 0.3 else 0.0
        k = 3.6
        tr[a] = row + [round(sog * k, 2), round(stw * k, 2), round(along * k, 2), round(math.hypot(ce, cn) * k, 2)]
R['currentsDay'] = 'sun'
json.dump(R, open('data/race.json', 'w'), separators=(',', ':'))

# quick summary per crew: time gained (+) or lost (-) to the current between start and finish
for c in sorted([c for c in R['teams'] if not c['safety']], key=lambda c: c['finish']):
    gain = 0.0
    tr = c['track']
    for a in range(1, len(tr)):
        if tr[a][0] <= 0 or tr[a - 1][0] >= c['finish'] or tr[a][6] is None or tr[a][7] is None:
            continue
        dt = min(tr[a][0], c['finish']) - max(tr[a - 1][0], 0)
        sog, stw = tr[a][6], tr[a][7]
        if stw > 2 and sog > 2:
            gain += dt * (1 - sog / stw) * -1  # extra time it would have taken at STW for the same ground distance
    print(f"{c['sail']:>6} {c['name'][:34]:34} current effect {gain / 60:+6.1f} min")
