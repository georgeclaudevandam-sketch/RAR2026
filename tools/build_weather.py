"""Add race-day weather to data/race.json.

Input: data/raw/weather_open-meteo.csv, the hourly CSV from the Open-Meteo archive
(temperature_2m, apparent_temperature, wind_speed_10m in knots, wind_direction_10m, cloud_cover).
Times in the CSV are local (America/Vancouver); the race started at 07:00 local.
"""
import csv, json, io

RAW = 'data/raw/weather_open-meteo.csv'
START_HOUR = 7  # 07:00 local start

text = open(RAW, encoding='utf-8-sig').read()
blocks = [b for b in text.strip().split('\n\n') if b.strip()]
meta = list(csv.DictReader(io.StringIO(blocks[0]))) if len(blocks) > 1 else [{}]
rows = list(csv.reader(io.StringIO(blocks[-1])))
head = [h.lower() for h in rows[0]]

def col(prefix):
    for i, h in enumerate(head):
        if h.startswith(prefix):
            return i
    return None

ci = {k: col(k) for k in ['time', 'temperature_2m', 'apparent_temperature', 'wind_speed_10m', 'wind_direction_10m', 'cloud_cover']}
num = lambda r, k: (float(r[ci[k]]) if ci[k] is not None and r[ci[k]] not in ('', None) else None)

out = []
for r in rows[1:]:
    if not r or not r[0]:
        continue
    hh, mm = r[ci['time']].split('T')[1].split(':')[:2]
    t = (int(hh) - START_HOUR) * 3600 + int(mm) * 60
    out.append([t, num(r, 'temperature_2m'), num(r, 'apparent_temperature'), num(r, 'wind_speed_10m'),
                num(r, 'wind_direction_10m'), num(r, 'cloud_cover')])

m = meta[0] if meta else {}
lat, lon = round(float(m.get('latitude', 48.83)), 3), round(float(m.get('longitude', -123.50)), 3)
elev = m.get('elevation')
day = rows[1][ci['time']].split('T')[0]
R = json.load(open('data/race.json'))
R['weather'] = {
    'source': f'Open-Meteo historical weather archive, hourly model data for {lat}, {lon} (central Salt Spring Island' + (f', model elevation {float(elev):.0f} m' if elev else '') + f'), {day}. Values over the water may differ slightly.',
    'note': 'Hourly air temperature over Salt Spring Island on race day, in °C (left scale) and °F (right scale). Hover for wind.',
    'rows': out,
}
json.dump(R, open('data/race.json', 'w'), separators=(',', ':'))
print(len(out), 'hours;', 'race window temps:', [r[1] for r in out if -3600 <= r[0] <= 36000])
