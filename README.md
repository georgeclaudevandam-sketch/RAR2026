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
| `data/race.json` | The processed file the site reads |

**About the date:** YB Tracking lists the race on Saturday 22 August. The regatta was held on Sunday 23 August, as listed on RegattaCentral, so the site shows Sunday. Clock times are unchanged.

To rebuild `data/race.json` from the raw files:

```
python3 tools/decode_yb_positions.py
python3 tools/build_race_json.py
```

Gate times are interpolated from the GPS track, which records positions about once a minute.
