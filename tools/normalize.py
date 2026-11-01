import json, re
S=json.load(open('standards.json'))
ROM=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII']
def target_of(title):
    for k,v in [('Single-Engine Land','ASEL'),('Single-Engine Sea','ASES'),('Multiengine Land','AMEL'),('Multiengine Sea','AMES'),('Helicopter','RH'),('Gyroplane','RG')]:
        if k.lower() in title.lower(): return v
def cell(v):
    v=re.sub(r'\s','',v or '')
    if v in ('All','*'): return {'all':True,'star':v=='*'}
    if v in ('None',''): return {'none':True}
    return {'tasks':[x for x in v.split(',') if x]}
for d in S['documents']:
    out={}
    for t in d['additional_rating_tables']:
        tgt=target_of(t['title']); rows=t['rows']
        if not tgt: continue
        hdr=next((r for r in rows if r and r[0].strip().startswith('Area of')),None)
        if hdr:
            cols=[c.strip() for c in hdr[1:]]
            m={}
            for r in rows:
                if r[0].strip() in ROM:
                    for i,c in enumerate(cols):
                        if c: m.setdefault(c,{})[r[0].strip()]=cell(r[i+1])
            out[tgt]=m
        else:  # PTS gyroplane layout: value rows precede roman label rows
            colmap={2:'ASEL',4:'ASES',5:'AMEL',6:'AMES',7:'RH',8:'Glider',9:'Powered Glider',10:'Balloon',11:'Airship'}
            m={}; pending=None
            for r in rows:
                if r[0].strip() in ROM and pending:
                    for i,c in colmap.items(): m.setdefault(c,{})[r[0].strip()]=cell(pending[i])
                    pending=None
                elif any(x.strip() for x in r[2:12]) and not any('Rating' in x or 'ASEL' in x or 'Glider' in x or 'Required' in x or 'Tasks must' in x or 'Addition' in x for x in r):
                    pending=r
            out[tgt]=m
    d['additional_rating']=out
    del d['additional_rating_tables']
    if out: print(d['id'],{k:list(v.keys()) for k,v in out.items()})
json.dump(S,open('standards.norm.json','w'),separators=(',',':'))
print(json.dumps(S['documents'][-2]['additional_rating'])[:800])
# Hand transcription of FAA-S-8081-16C Additional Rating Task Table (PDF layout splits cells across rows).
cols=['ASEL','ASES','AMEL','AMES','RH','Glider','Powered Glider','Balloon','Airship']
rows={'I':['A,F,G']*9,'II':['All']*9,'III':['B','B,C','B','B,C','B','All','B','All','B'],'IV':['All']*9,'V':['All']*9,'VI':['*']*9,
 'VII':['None']*5+['B,C,D']*3+['None'],'VIII':['All']*9,'IX':['All']*9,'X':['All','All','All','All','None','All','All','All','All']}
for d in S['documents']:
    if d['id']=='pts16':
        d['additional_rating']={'RG':{c:{r:cell(v[i]) for r,v in rows.items()} for i,c in enumerate(cols)}}
json.dump(S,open('standards.norm.json','w'),separators=(',',':'))
