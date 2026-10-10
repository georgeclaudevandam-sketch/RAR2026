"""Read current arrows from PNW Current Atlas screenshots (CHS current atlas data) into data/raw/atlas_arrows.json.

Usage: python3 tools/extract_atlas_arrows.py "path/to/CHS Aug 23 *.png" ...
File names must contain the clock time, e.g. "CHS Aug 23 1116 am.png" (local time, PDT).

How it works
- All screenshots share one view. The map was aligned to the OpenStreetMap coastline (mean mismatch ~6% of
  pixels, mostly anti-aliasing): lon = LON0 + x / SX, lat = LAT0 - y / SY, with (x, y) in screenshot pixels
  measured from the top of the map area (y = 300 in the full screenshot).
- Arrows are blue shapes of constant length; the atlas shows speed by arrow THICKNESS. Each arrow's direction
  comes from its long axis, pointing toward the wider (arrowhead) end. '+' marks are slack water (0 kn).
- Thickness classes were calibrated to knots against the official CHS 2026 tables at Active Pass, Porlier Pass,
  Trincomali Channel, Swanson Channel and Sansum Narrows (see README). The class centres are approximate.
"""
import json, math, re, sys
import numpy as np
from PIL import Image
from scipy import ndimage

Y0, Y1 = 300, 2552                       # map area within the 1290 x 2796 screenshot
LON0, SX, LAT0, SY = -123.73712571428541, 2802.802802785007, 49.103919478835955, 4258.6055959143105
# arrow thickness (px) -> speed (knots): class centres
WIDTH_CLASSES = [(6.5, 0.3), (10.0, 0.7), (11.8, 1.2), (14.2, 2.0), (16.8, 3.0), (20.5, 4.0), (25.7, 5.5)]


def knots(width):
    return min(WIDTH_CLASSES, key=lambda c: abs(c[0] - width))[1]


def extract(fn):
    im = np.array(Image.open(fn).convert('RGB')).astype(int)[Y0:Y1]
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    blue = (b > 150) & (b - r > 90) & (b - g > 20)
    lab, _ = ndimage.label(blue, structure=np.ones((3, 3)))
    out = []
    for k, sl in enumerate(ndimage.find_objects(lab), 1):
        m = lab[sl] == k
        area = int(m.sum())
        if area < 25:
            continue
        ys, xs = np.nonzero(m); ys = ys + sl[0].start; xs = xs + sl[1].start
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        cy, cx = ys.mean(), xs.mean()
        P = np.c_[xs - cx, ys - cy]
        ev, evec = np.linalg.eigh(P.T @ P / len(P))
        lat, lon = LAT0 - cy / SY, LON0 + cx / SX
        if math.sqrt(ev[1] / max(ev[0], 1e-6)) < 2.2 and max(h, w) < 40:      # '+' slack marker
            out.append([round(lat, 5), round(lon, 5), 0.0, 0.0])
            continue
        ax = evec[:, 1]; along = P @ ax; perp = P @ evec[:, 0]
        L = along.max() - along.min()
        if L < 25:
            continue
        lo, hi = along.min(), along.max()
        e1 = np.abs(perp[along < lo + 0.3 * L]).mean()
        e2 = np.abs(perp[along > hi - 0.3 * L]).mean()
        d = ax * (1 if e2 > e1 else -1)          # toward the arrowhead
        kn = knots(area / max(L, 1) if L > 60 else area / 67.4)   # clipped arrows at the map edge: use full length
        brg = (math.degrees(math.atan2(d[0], -d[1])) + 360) % 360  # screen y points south
        out.append([round(lat, 5), round(lon, 5), kn, round(brg, 1)])
    return out


if __name__ == '__main__':
    frames = {}
    for fn in sys.argv[1:]:
        m = re.search(r'(\d{1,2})(\d{2}) ?(am|pm)', fn.split('/')[-1], re.I)
        h, mi = int(m.group(1)), int(m.group(2))
        if m.group(3).lower() == 'pm' and h != 12:
            h += 12
        frames[f'{h:02d}:{mi:02d}'] = extract(fn)
        print(fn.split('/')[-1], '->', f'{h:02d}:{mi:02d}', len(frames[f'{h:02d}:{mi:02d}']), 'vectors')
    json.dump({'source': 'PNW Current Atlas (Canadian Hydrographic Service current atlas data), Sun 23 Aug 2026; '
                         'arrows read from screenshots, speeds approximate (from arrow thickness).',
               'columns': ['lat', 'lon', 'knots', 'toward_deg_true'],
               'frames': dict(sorted(frames.items()))},
              open('data/raw/atlas_arrows.json', 'w'), separators=(',', ':'))
