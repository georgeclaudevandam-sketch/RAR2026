import json, math
S=json.loads(open('data/raw/RaceSetup.json','rb').read().decode('cp1252'))
L=json.loads(open('data/raw/leaderboard.json','rb').read().decode('cp1252'))
P={int(k):v for k,v in json.load(open('data/raw/positions.json')).items()}
DAY_SHIFT=86400  # YB lists Sat Aug 22; regatta was Sun Aug 23
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
     'dateNote':'YB Tracking lists this race on Saturday 22 Aug 2026; the regatta was held Sunday 23 Aug 2026 (RegattaCentral). Times are shown on Sunday 23 Aug; clock times are unchanged.',
     'gates':gates,'course':course,'teams':teams}
json.dump(out,open('data/race.json','w'),separators=(',',':'))
import os;print('bytes',os.path.getsize('data/race.json'))
for t in sorted([t for t in teams if not t['safety']],key=lambda t:t['rank'] or 99):
    print(t['rank'],t['name'][:40],t['division'],t['finish'],t['trackKm'],{k[:7]:v for k,v in t['splits'].items()})
