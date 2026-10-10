import json, math
S=json.loads(open('data/raw/RaceSetup.json','rb').read().decode('cp1252'))
L=json.loads(open('data/raw/leaderboard.json','rb').read().decode('cp1252'))
P={int(k):v for k,v in json.load(open('data/raw/positions.json')).items()}
DAY_SHIFT=0  # YB timestamps are already Sunday 23 Aug 2026 (07:00 PDT start = 14:00 UTC)
T0=1787493600    # official start 07:00 PDT
def hav(a,b,c,d):
    R=6371.0088;p1,p2=math.radians(a),math.radians(c);dp=p2-p1;dl=math.radians(d-b)
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))
def inter(p1,p2,q1,q2):
    # returns fraction along p1->p2 if segments intersect (x=lon,y=lat)
    (y1,x1),(y2,x2),(y3,x3),(y4,x4)=p1,p2,q1,q2
    den=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4)
    if den==0: return None
    t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/den
    u=-((x1-x2)*(y1-y3)-(y1-y2)*(x1-x3))/den
    return t if 0<=t<=1 and 0<=u<=1 else None
def clean(pts):
    """Drop clearly bad YB fixes (tuned against crew 204's 1-second Niobium track: no good fixes dropped).
    1) Near-duplicate fixes (<15 s apart): drop the one more than 60 m from where its neighbours put the boat.
    2) Isolated spikes: more than 100 m off the neighbours' line AND needing > 4 m/s (7.8 kn) both in and out."""
    pts = list(pts); dropped = []
    def off(a, b, c):
        f = (b['t'] - a['t']) / max(c['t'] - a['t'], 1)
        return hav(b['lat'], b['lon'], a['lat'] + f * (c['lat'] - a['lat']), a['lon'] + f * (c['lon'] - a['lon'])) * 1000
    i = 1
    while i < len(pts) - 2:
        if pts[i + 1]['t'] - pts[i]['t'] < 15:
            o1, o2 = off(pts[i - 1], pts[i], pts[i + 2]), off(pts[i - 1], pts[i + 1], pts[i + 2])
            if max(o1, o2) > 60:
                k = i if o1 > o2 else i + 1
                dropped.append(pts[k]['t']); del pts[k]; continue
        i += 1
    while True:
        bad = None
        for i in range(1, len(pts) - 1):
            a, b, c = pts[i - 1], pts[i], pts[i + 1]
            if c['t'] - a['t'] > 360 or c['t'] == a['t']:
                continue
            o = off(a, b, c)
            v1 = hav(a['lat'], a['lon'], b['lat'], b['lon']) * 1000 / max(b['t'] - a['t'], 1)
            v2 = hav(b['lat'], b['lon'], c['lat'], c['lon']) * 1000 / max(c['t'] - b['t'], 1)
            if o > 100 and v1 > 4 and v2 > 4 and (bad is None or o > bad[1]): bad = (i, o)
        if bad is None: return pts, dropped
        dropped.append(pts[bad[0]]['t']); del pts[bad[0]]

gates=[]
for ln in S['poi']['lines']:
    v=[float(x) for x in ln['nodes'].split(',')]
    if len(v)!=4: continue
    nm=ln['name'].strip()
    short=nm.split(' - ')[1].split(' (')[0] if ' - ' in nm else nm
    gates.append({'name':nm,'short':short,'mandatory':'Mandatory' in nm,'a':[v[0],v[1]],'b':[v[2],v[3]]})
print([g['name'] for g in gates])
lb={t['id']:t for t in L['tags'][0]['teams']}
tagname={t['id']:t['name'] for t in S['tags']}
teams=[]
for tm in S['teams']:
    tid=tm['id']
    if tid not in P: continue
    pts=P[tid]
    safety = 84288 in tm['tags'] or 'SAFETY' in tm['name'].upper()
    if not safety:
        pts, dropped = clean(pts)
        if dropped: print(f"  {tm.get('sail')}: dropped {len(dropped)} bad YB fixes", [round((d-T0)/60) for d in dropped])
    div='Safety' if safety else [tagname[x] for x in tm['tags'] if x!=84284][0]
    # cumulative distance + speed
    cum=[0.0]
    for i in range(1,len(pts)):
        cum.append(cum[-1]+hav(pts[i-1]['lat'],pts[i-1]['lon'],pts[i]['lat'],pts[i]['lon']))
    track=[]
    j=0
    for i,m in enumerate(pts):
        # speed over trailing ~5 min window
        while pts[j]['t'] < m['t']-300: j+=1
        dt=m['t']-pts[j]['t']
        sp=(cum[i]-cum[j])/(dt/3600) if dt>=60 else None
        track.append([m['t']-T0, round(m['lat'],5), round(m['lon'],5), m.get('dtf'), round(cum[i],3), None if sp is None else round(sp,2)])
    # gate crossings (first crossing after start)
    splits={}
    for g in [g for g in gates if g['name'].startswith('Gate')]:
        for i in range(1,len(pts)):
            if pts[i]['t']<T0: continue
            f=inter((pts[i-1]['lat'],pts[i-1]['lon']),(pts[i]['lat'],pts[i]['lon']),g['a'],g['b'])
            if f is not None:
                tt=pts[i-1]['t']+f*(pts[i]['t']-pts[i-1]['t'])
                if g['name'].startswith('Start') and tt<T0: continue
                splits[g['name']]=round(tt-T0)
                if not g['name'].startswith('Start'): break
    l=lb.get(tid,{})
    teams.append({'id':tid,'name':tm['name'],'sail':tm.get('sail'),'division':div,'safety':safety,
        'colour':'#'+tm.get('colour','888888'),'captain':tm.get('captain'),'boat':tm.get('type3d'),
        'finish':(tm.get('finishedAt')-T0) if tm.get('finishedAt') and not safety else None,
        'rank':l.get('rankR'),'trackKm':round(cum[-1],2),'splits':splits,'track':track})
course=[[round(n['lat'],6),round(n['lon'],6),n.get('name')] for n in S['course']['nodes']]
out={'title':S['title'],'source':'https://yb.tl/rar2026','raceStartEpoch':T0+DAY_SHIFT,'tz':'America/Vancouver',
     'courseKm':round(L['tags'][0]['teams'][0]['d24']/1000,2) if 'd24' in L['tags'][0]['teams'][0] else None,
     'gates':gates,'course':course,'teams':teams}
json.dump(out,open('data/race.json','w'),separators=(',',':'))
import os;print('bytes',os.path.getsize('data/race.json'))
for t in sorted([t for t in teams if not t['safety']],key=lambda t:t['rank'] or 99):
    print(t['rank'],t['name'][:40],t['division'],t['finish'],t['trackKm'],{k[:7]:v for k,v in t['splits'].items()})
