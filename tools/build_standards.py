import re, json, sys, hashlib, pymupdf
sys.path.insert(0, '/home/user/workspace/smartpoa/tools')
SRC='/tmp/acs/'
ROMAN=r'[IVXL]+'
def clean(s): return re.sub(r'\s+',' ',s).strip()

def parse_acs(path):
    lines=open(path,encoding='utf-8',errors='ignore').read().replace('\f','\n').split('\n')
    area_re=re.compile(r'^\s*Area of Operation ('+ROMAN+r')\.\s+(.*?)\s*$')
    task_re=re.compile(r'^\s*Task ([A-Z])\.\s+(.*?)\s*$')
    el_re=re.compile(r'^\s*([A-Z]{2,3}\.('+ROMAN+r')\.([A-Z])\.([KRS])(\d+)([a-z]?))\s+(.*)$')
    first=next(i for i,l in enumerate(lines) if task_re.match(l) and '...' not in l and any('References:' in x for x in lines[i+1:i+6]))
    start=max(i for i in range(first) if area_re.match(lines[i]))
    areas={};order=[];ca=None;ct=None;field=None;le=None
    for raw in lines[start:]:
        l=raw.rstrip(); s=l.strip()
        if not s or '....' in l: continue
        if re.match(r'^.*\(FAA-S-(ACS|8081)-[\w-]+\)\s+\d+\s*$',l) or re.match(r'^\s*\d+\s*$',l): continue
        if re.match(r'^\s*Appendix\s+\d',l): break
        m=area_re.match(l)
        if m:
            rn=m.group(1)
            if rn not in areas:
                areas[rn]={'roman':rn,'title':clean(m.group(2)),'notes':[],'tasks':[]};order.append(rn);ca=areas[rn];ct=None;field='atitle'
            else: ca=areas[rn]
            continue
        m=task_re.match(l)
        if m and ca is not None:
            ex=[t for t in ca['tasks'] if t['letter']==m.group(1)]
            if ex: ct=ex[0]; field=None; continue
            ct={'letter':m.group(1),'title':m.group(2),'references':'','objective':'','notes':[],'elements':[]}
            ca['tasks'].append(ct); field='title'; le=None; continue
        if s.startswith('Note:'):
            (ct['notes'] if ct else ca['notes']).append(s[5:].strip()); field='note'; continue
        if ct is None:
            if field=='note' and ca and ca['notes']: ca['notes'][-1]+=' '+s
            continue
        if s.startswith('References:'): ct['references']=s[11:].strip(); field='ref'; continue
        if s.startswith('Objective:'): ct['objective']=s[10:].strip(); field='obj'; continue
        if re.match(r'^(Knowledge|Risk Management|Risk|Management|Skills?)\b',s) and len(s)<120 and not el_re.match(l):
            field='hdr'; continue
        m=el_re.match(l)
        if m:
            txt=m.group(7).strip()
            if m.group(6): txt=re.sub(r'^[a-z]\.\s+','',txt)
            le={'code':m.group(1),'type':m.group(4),'num':int(m.group(5)),'sub':m.group(6) or None,'text':txt}
            ct['elements'].append(le); field='el'; continue
        if field=='ref': ct['references']+=' '+s
        elif field=='obj': ct['objective']+=' '+s
        elif field=='note': ct['notes'][-1]+=' '+s
        elif field=='el' and le: le['text']+=' '+s
        elif field=='title': ct['title']+=' '+s
    out=[areas[r] for r in order]
    for a in out:
        for t in a['tasks']:
            t['title']=clean(t['title']); t['references']=clean(t['references']); t['objective']=clean(t['objective'])
            t['notes']=[clean(n) for n in t['notes']]
            for e in t['elements']: e['text']=clean(e['text'])
            groups=re.findall(r'\(([^)]*)\)',t['title'])
            cls=[];flags=[]
            for g in groups:
                parts=[p.strip() for p in g.split(',')]
                if all(p in ('ASEL','AMEL','ASES','AMES') for p in parts): cls+=parts
                elif g.strip()=='ATP': flags.append('ATP')
            t['classes']=cls or None; t['flags']=flags
            t['title_plain']=clean(re.sub(r'\((ASEL|AMEL|ASES|AMES|ATP)[^)]*\)','',t['title']))
        a['notes']=[clean(n) for n in a['notes']]
    return out

def parse_pts(path):
    lines=open(path,encoding='utf-8',errors='ignore').read().replace('\f','\n').split('\n')
    area_re1=re.compile(r'^\s*('+ROMAN+r')\.\s+AREA OF OPERATION:\s*(.*?)\.?\s*$')
    area_re2=re.compile(r'^\s*('+ROMAN+r')\.\s+([A-Z][A-Za-z ,/&-]+)\s*$')
    task_re1=re.compile(r'^\s*([A-Z])\.\s+(?:TASK|Task):\s*(.*?)\s*$')
    task_re2=re.compile(r'^\s*Task ([A-Z]):\s*(.*?)\s*$')
    obj_item=re.compile(r'^\s*(\d+)\.\s+(.*)$'); sub_item=re.compile(r'^\s*([a-z])\.\s+(.*)$')
    first=next(i for i,l in enumerate(lines) if (task_re1.match(l) or task_re2.match(l)) and '...' not in l and any(re.match(r'\s*REFERENCES?:|\s*References:',x,re.I) for x in lines[i+1:i+5]))
    start=max(i for i in range(first) if area_re1.match(lines[i]) or area_re2.match(lines[i]))
    areas={};order=[];ca=None;ct=None;field=None;le=None;cur_num=None
    for raw in lines[start:]:
        l=raw.rstrip(); s=l.strip()
        if not s or '....' in l or re.match(r'^\s*\d+\s*$',l): continue
        if re.match(r'^\s*(APPENDIX|Appendix)\b',l) and ct: break
        m=area_re1.match(l) or (area_re2.match(l) if not ct or field!='el' or len(s)<60 else None)
        if m and (area_re1.match(l) or re.match(r'^('+ROMAN+r')\.\s',s)) and not task_re2.match(l):
            rn=m.group(1); title=clean(m.group(2)).title() if m.group(2).isupper() else clean(m.group(2))
            if rn not in areas:
                areas[rn]={'roman':rn,'title':title,'notes':[],'tasks':[]};order.append(rn);ct=None;field=None
            ca=areas[rn]; continue
        m=task_re1.match(l) or task_re2.match(l)
        if m and ca is not None:
            title=m.group(2); title=title.title() if title.isupper() else title
            ex=[t for t in ca['tasks'] if t['letter']==m.group(1)]
            if ex: ct=ex[0]; continue
            ct={'letter':m.group(1),'title':clean(title),'references':'','objective':'','notes':[],'elements':[]}
            ca['tasks'].append(ct); field='title'; continue
        if re.match(r'^NOTE:|^Note:',s,re.I):
            (ct['notes'] if ct else ca['notes'] if ca else []).append(s[5:].strip()); field='note'; continue
        if ct is None:
            if field=='note' and ca and ca['notes']: ca['notes'][-1]+=' '+s
            continue
        if re.match(r'^REFERENCES?:',s,re.I): ct['references']=s.split(':',1)[1].strip(); field='ref'; continue
        if s.startswith('Objective'): ct['objective']=s.split('.',1)[1].strip() if s.startswith('Objective.') else s.split(':',1)[1].strip(); field='obj'; continue
        m=obj_item.match(l)
        if m and field in ('obj','el','note','ref'):
            cur_num=int(m.group(1)); le={'code':None,'type':'O','num':cur_num,'sub':None,'text':m.group(2).strip()}; ct['elements'].append(le); field='el'; continue
        m=sub_item.match(l)
        if m and field=='el' and cur_num:
            le={'code':None,'type':'O','num':cur_num,'sub':m.group(1),'text':m.group(2).strip()}; ct['elements'].append(le); continue
        if field=='ref': ct['references']+=' '+s
        elif field=='obj': ct['objective']+=' '+s
        elif field=='note' and ct['notes']: ct['notes'][-1]+=' '+s
        elif field=='el' and le: le['text']+=' '+s
    out=[areas[r] for r in order]
    for a in out:
        for t in a['tasks']:
            t['references']=clean(t['references']); t['objective']=clean(t['objective']); t['notes']=[clean(n) for n in t['notes']]
            for e in t['elements']: e['text']=clean(e['text'])
            t['classes']=None; t['flags']=[]; t['title_plain']=t['title']
        a['notes']=[clean(n) for n in a['notes']]
    return [a for a in out if a['tasks']]

def addl_tables(pdf):
    d=pymupdf.open(pdf); res=[]
    for i,p in enumerate(d):
        t=p.get_text()
        if 'Rating(s) Held' not in t and 'Rating(s)\nHeld' not in t: continue
        titles=[clean(x) for x in re.findall(r'(Addition of [^\n]+(?:\n[^\n]+)?)',t)]
        for tb in p.find_tables():
            rows=[[clean(c or '') for c in r] for r in tb.extract()]
            if len(rows)<3: continue
            res.append({'page':i+1,'title':titles[0] if titles else '','rows':rows})
    return res

def appendix_ops(path):
    txt=open(path,encoding='utf-8',errors='ignore').read().replace('\f','\n')
    m=[x.start() for x in re.finditer(r'\n\s*Appendix 3[^\n]*Operational Requirements',txt)] or [x.start() for x in re.finditer(r'Operational Requirements, Limitations',txt)]
    if not m: return ''
    seg=txt[m[-1]:m[-1]+30000]
    end=re.search(r'\n\s*Appendix 4',seg)
    seg=seg[:end.start()] if end else seg
    seg='\n'.join(l for l in seg.split('\n') if not re.match(r'^.*\(FAA-S-ACS-[\w-]+\)\s+\d+\s*$',l) and not re.match(r'^\s*\d+\s*$',l))
    return re.sub(r'\n{3,}','\n\n',seg).strip()

DOCS=[
 dict(id='acs6c',num='FAA-S-ACS-6C',title='Private Pilot for Airplane Category ACS',kind='ACS',cert='private',category='airplane',file='private_airplane_acs_6',url='https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf',classes=['ASEL','AMEL','ASES','AMES']),
 dict(id='acs7b',num='FAA-S-ACS-7B',title='Commercial Pilot for Airplane Category ACS',kind='ACS',cert='commercial',category='airplane',file='commercial_airplane_acs_7',url='https://www.faa.gov/training_testing/testing/acs/commercial_airplane_acs_7.pdf',classes=['ASEL','AMEL','ASES','AMES']),
 dict(id='acs8c',num='FAA-S-ACS-8C',title='Instrument Rating – Airplane ACS',kind='ACS',cert='instrument',category='airplane',file='instrument_rating_airplane_acs_8',url='https://www.faa.gov/training_testing/testing/acs/instrument_rating_airplane_acs_8.pdf',classes=None),
 dict(id='acs11a',num='FAA-S-ACS-11A',title='Airline Transport Pilot and Type Rating for Airplane Category ACS',kind='ACS',cert='atp',category='airplane',file='atp_airplane_acs_11',url='https://www.faa.gov/training_testing/testing/acs/atp_airplane_acs_11.pdf',classes=['AMEL','AMES','ASEL','ASES']),
 dict(id='acs25',num='FAA-S-ACS-25',title='Flight Instructor for Airplane Category ACS',kind='ACS',cert='cfi',category='airplane',file='cfi_airplane_acs_25',url='https://www.faa.gov/training_testing/testing/acs/cfi_airplane_acs_25.pdf',classes=['ASEL','AMEL','ASES','AMES']),
 dict(id='acs15',num='FAA-S-ACS-15',title='Private Pilot for Rotorcraft Category Helicopter Rating ACS',kind='ACS',cert='private',category='rotorcraft-helicopter',file='private_helicopter_acs_15',url='https://www.faa.gov/training_testing/testing/acs/private_helicopter_acs_15.pdf',classes=None),
 dict(id='acs16',num='FAA-S-ACS-16',title='Commercial Pilot for Rotorcraft Category Helicopter Rating ACS',kind='ACS',cert='commercial',category='rotorcraft-helicopter',file='commercial_helicopter_acs_16',url='https://www.faa.gov/training_testing/testing/acs/commercial_helicopter_acs_16.pdf',classes=None),
 dict(id='acs14',num='FAA-S-ACS-14',title='Instrument Rating – Helicopter ACS',kind='ACS',cert='instrument',category='rotorcraft-helicopter',file='instrument_helicopter_acs_14',url='https://www.faa.gov/training_testing/testing/acs/instrument_helicopter_acs_14.pdf',classes=None),
 dict(id='pts20',num='FAA-S-8081-20',title='Airline Transport Pilot and Aircraft Type Rating PTS – Helicopter',kind='PTS',cert='atp',category='rotorcraft-helicopter',file='atp_helicopter_pts_20',url='https://www.faa.gov/training_testing/testing/acs/atp_helicopter_pts_20.pdf',classes=None),
 dict(id='pts15b',num='FAA-S-8081-15B',title='Private Pilot PTS – Rotorcraft Category Gyroplane Rating',kind='PTS',cert='private',category='rotorcraft-gyroplane',file='private_gyroplane_pts_15',url='https://www.faa.gov/training_testing/testing/acs/private_gyroplane_pts_15.pdf',classes=None),
 dict(id='pts16',num='FAA-S-8081-16',title='Commercial Pilot PTS – Rotorcraft Category Gyroplane Rating',kind='PTS',cert='commercial',category='rotorcraft-gyroplane',file='commercial_gyroplane_pts_16',url='https://www.faa.gov/training_testing/testing/acs/commercial_gyroplane_pts_16.pdf',classes=None),
]
out=[]
for d in DOCS:
    txtp=SRC+d['file']+'.txt'; pdf=SRC+d['file']+'.pdf'
    raw=open(txtp,encoding='utf-8',errors='ignore').read()
    m=re.search(r'FAA-S-(?:ACS|8081)-[\w]+',raw[:3000]); d['num']=m.group(0) if m else d['num']
    em=re.search(r'(?:Effective|effective)[^\n]{0,40}?((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4})',raw[:20000])
    pm=re.search(r'((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4})',raw[:2500])
    d['effective']=em.group(1) if em else None; d['edition_date']=pm.group(1) if pm else None
    d['sha256']=hashlib.sha256(open(pdf,'rb').read()).hexdigest()
    d['areas']=parse_acs(txtp) if d['kind']=='ACS' else parse_pts(txtp)
    d['additional_rating_tables']=addl_tables(pdf)
    d['operational_appendix']=appendix_ops(txtp) if d['kind']=='ACS' else ''
    d.pop('file')
    nt=sum(len(a['tasks']) for a in d['areas']); ne=sum(len(t['elements']) for a in d['areas'] for t in a['tasks'])
    print(d['id'],d['num'],d['effective'],d['edition_date'],len(d['areas']),'areas',nt,'tasks',ne,'el',len(d['additional_rating_tables']),'tables',len(d['operational_appendix']),'appx')
    out.append(d)
json.dump({'generated':'2026-11-01','documents':out},open('/home/user/workspace/smartpoa/tools/standards.json','w'),indent=1)
