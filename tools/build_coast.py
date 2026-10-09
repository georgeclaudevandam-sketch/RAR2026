"""Build a high-resolution land/water mask from OpenStreetMap coastlines, so the current animation
stops at the real shoreline instead of the ocean model's coarse (about 500 m) coastline.

Input:  data/raw/osm_coastline.json  Overpass export: way["natural"="coastline"](48.66,-123.72,49.00,-123.26); out geom;
Output: data/coast.json              1-bit water mask (1 = water), row-major from the south-west corner, base64.

Method: draw every coastline segment onto a fine raster as a barrier, then flood-fill the water starting
from points on the race course. Everything the fill reaches is sea; islands, lakes and the rest are land.
"""
import base64, json
import numpy as np
from scipy import ndimage

LAT0, LAT1, LON0, LON1 = 48.66, 49.00, -123.72, -123.26
DLAT, DLON = 0.00027, 0.00036            # about 30 m x 26 m
NY = int(round((LAT1 - LAT0) / DLAT)); NX = int(round((LON1 - LON0) / DLON))

osm = json.load(open('data/raw/osm_coastline.json', encoding='utf-8'))
barrier = np.zeros((NY, NX), bool)
for el in osm.get('elements', []):
    g = el.get('geometry') or []
    for a, b in zip(g, g[1:]):
        if not a or not b:
            continue
        y0, x0 = (a['lat'] - LAT0) / DLAT, (a['lon'] - LON0) / DLON
        y1, x1 = (b['lat'] - LAT0) / DLAT, (b['lon'] - LON0) / DLON
        n = int(max(abs(y1 - y0), abs(x1 - x0)) * 3) + 2
        ys = np.linspace(y0, y1, n); xs = np.linspace(x0, x1, n)
        ok = (ys >= 0) & (ys < NY) & (xs >= 0) & (xs < NX)
        barrier[ys[ok].astype(int), xs[ok].astype(int)] = True
barrier = ndimage.binary_dilation(barrier, structure=np.ones((3, 3), bool))  # seal diagonal gaps

labels, n = ndimage.label(~barrier)
R = json.load(open('data/race.json'))
seeds = set()
for lat, lon, *_ in R['course']:
    j, i = int((lat - LAT0) / DLAT), int((lon - LON0) / DLON)
    if 0 <= j < NY and 0 <= i < NX and labels[j, i]:
        seeds.add(labels[j, i])
water = np.isin(labels, list(seeds))
# the coastline pixels themselves: water if most neighbours are water (keeps narrow passages open)
edge = barrier & (ndimage.uniform_filter(water.astype(float), 5) > 0.5)
water |= edge
print(f'grid {NY} x {NX}; components {n}; seeded {len(seeds)}; water {water.mean():.1%}')

bits = np.packbits(water.ravel().astype(np.uint8))
out = {'source': 'OpenStreetMap coastline (© OpenStreetMap contributors, ODbL)',
       'lat0': LAT0, 'lon0': LON0, 'dlat': DLAT, 'dlon': DLON, 'nLat': NY, 'nLon': NX,
       'bits': base64.b64encode(bits.tobytes()).decode()}
json.dump(out, open('data/coast.json', 'w'), separators=(',', ':'))

# quick-look image for checking (not published)
try:
    import zlib, struct
    img = np.where(water[::-1], 255, 0).astype(np.uint8)
    raw = b''.join(b'\x00' + row.tobytes() for row in img)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', NX, NY, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    import sys
    if len(sys.argv) > 1:
        open(sys.argv[1], 'wb').write(png)
except Exception as e:
    print('preview skipped:', e)
