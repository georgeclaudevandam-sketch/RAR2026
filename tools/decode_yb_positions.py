import struct, json, sys
d=open('data/raw/AllPositions3.bin','rb').read()
p=0
def rd(fmt):
    global p
    v=struct.unpack_from('>'+fmt,d,p); p+=struct.calcsize('>'+fmt); return v[0]
flags=rd('B'); hasAlt=flags&1; hasDtf=flags&2; hasLaps=flags&4; hasPc=flags&8
ref=rd('I')
teams={}
while p < len(d):
    tid=rd('H'); n=rd('H'); pts=[]; prev=None
    for i in range(n):
        b=d[p]
        m={}
        if b & 0x80:
            w=rd('H') & 0x7fff
            dlat=rd('h'); dlon=rd('h')
            if hasAlt: m['alt']=rd('h')
            if hasDtf: m['dtf']=prev['dtf']+rd('h')
            if hasLaps: m['lap']=rd('B')
            if hasPc: m['pc']=prev['pc']+rd('h')/32000
            m['lat']=prev['lat']+dlat; m['lon']=prev['lon']+dlon; m['at']=prev['at']-w
        else:
            t=rd('I'); m['lat']=rd('i'); m['lon']=rd('i')
            if hasAlt: m['alt']=rd('h')
            if hasDtf: m['dtf']=rd('i')
            if hasLaps: m['lap']=rd('B')
            if hasPc: m['pc']=rd('i')/21000000
            m['at']=ref+t
        pts.append(m); prev=m
    teams[tid]=pts
print('flags',flags,'ref',ref,'teams',len(teams))
out={}
for tid,pts in teams.items():
    pts=sorted(pts,key=lambda m:m['at'])
    out[tid]=[{'t':m['at'],'lat':m['lat']/1e5,'lon':m['lon']/1e5,**({'dtf':m['dtf']} if 'dtf' in m else {})} for m in pts]
    a,b=out[tid][0],out[tid][-1]
    print(tid,len(pts),a['t'],b['t'],(b['t']-a['t'])/3600, a['lat'],a['lon'],b['lat'],b['lon'], a.get('dtf'), b.get('dtf'))
json.dump(out,open('data/raw/positions.json','w'))
