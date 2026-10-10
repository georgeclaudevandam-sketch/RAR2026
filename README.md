# Race Around the Rock 2026: Race Day Analytics

An interactive replay and analysis of **Race Around the Rock 2026**, an 87 km rowing circumnavigation of Salt Spring Island, BC, held on **Sunday 23 August 2026**. The race started and finished in Fulford Harbour.

**Live site:** https://georgeclaudevandam-sketch.github.io/RAR2026/

## What's on the site

- **Race map replay.** Every crew's GPS position through the day, with a time slider, play button and trails, drawn on the real coastline with the course and gates.
- **Leaderboard at any moment.** Positions, time behind the leader, distance to go and current pace per 500 m.
- **Comparison charts.** Distance behind the leader, and boat speed against the middle half of the field.
- **Leg splits** between the six gates, with leg ranks.
- **Final results**, overall and by division.

Choose your crew and up to two others to compare at the top of the page. The selection is kept in the link, so you can share a view, for example:
`?crew=205&vs=401,201`

## Data

All positions and results come from [YB Tracking](https://yb.tl/rar2026).

| File | What it is |
|---|---|
| `data/raw/RaceSetup.json` | Course, gates and crew list, as downloaded from YB |
| `data/raw/leaderboard.json` | Official finish times, as downloaded from YB |
| `data/raw/AllPositions3.bin` | GPS positions for every boat (YB binary format) |
| `data/raw/crew204_niobium.csv`, `crew204_maptattoo.gpx` | Crew 204's own recordings (1 s and 10 s) |
| `data/race.json` | The processed file the site reads |

To rebuild `data/race.json` from the raw files:

```
python3 tools/decode_yb_positions.py
python3 tools/build_race_json.py
python3 tools/build_crew_detail.py # crew 204's own Niobium + Maptattoo recordings replace its YB track
python3 tools/build_weather.py
python3 tools/build_coast.py      # shoreline mask from data/raw/osm_coastline.json
python3 tools/build_currents.py   # currents from data/raw/atlas_arrows.json (CHS atlas), else the UBC model   # adds race-day weather from data/raw/weather_open-meteo.csv
```

Gate times are interpolated from the GPS track, which records positions about once a minute.

## Currents

Surface currents come from the **PNW Current Atlas** (Canadian Hydrographic Service current atlas data) for
Sunday 23 August 2026. Arrows were read from 11 screenshots (06:26 to 18:13) by `tools/extract_atlas_arrows.py`:
the map was aligned to the OpenStreetMap coastline, and each arrow's direction and thickness were measured.
The atlas shows speed by arrow thickness; the thickness classes were calibrated against the official CHS 2026
current tables at Active Pass, Porlier Pass, Trincomali Channel, Swanson Channel and Sansum Narrows, so speeds
are approximate (roughly 0.3, 0.7, 1.2, 2, 3, 4 and 5.5 knots). Between atlas times the field is blended
linearly. The screenshots themselves are not published here.

An earlier version used the UBC SalishSeaCast ocean model (`CURRENT_SOURCE=model`), which did not match
race-day conditions in Stuart Channel.

## Data cleaning

YB tracker fixes that are clearly wrong are dropped (`clean()` in `tools/build_race_json.py`): near-duplicate fixes
more than 60 m from where their neighbours put the boat, and isolated spikes more than 100 m off line that would need
over 4 m/s both in and out. The rule was tuned against crew 204's 1-second track, where it removed no good fixes.
