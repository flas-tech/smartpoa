import re, json, sys
ROMAN = r'[IVXL]+'
def parse_acs(path, doc_id, prefix_hint=None):
    lines = open(path, encoding='utf-8', errors='ignore').read().replace('\f','\n').split('\n')
    areas = {}; order=[]
    cur_area=None; cur_task=None; field=None; last_el=None
    # skip TOC: start after first body "Task A." line that is not dotted and follows area header
    def is_toc(l): return '....' in l or re.search(r'\.\s?\d+\s*$', l) and '. .' in l
    el_re = re.compile(r'^\s*([A-Z]{2,3}\.('+ROMAN+r')\.([A-Z])\.([KRS])(\d+)([a-z]?))\s+(.*)$')
    area_re = re.compile(r'^\s*Area of Operation ('+ROMAN+r')\.\s+(.*?)\s*$')
    task_re = re.compile(r'^\s*Task ([A-Z])\.\s+(.*?)\s*$')
    stop_re = re.compile(r'^\s*Appendix (1|Table)', re.I)
    started=False
    first_el = next(i for i,l in enumerate(lines) if task_re.match(l) and '...' not in l and any('References:' in x for x in lines[i+1:i+6]))
    body_start = max(i for i in range(first_el) if area_re.match(lines[i]))
    lines = lines[body_start:]
    for raw in lines:
        l = raw.rstrip()
        if not l.strip(): 
            continue
        if '....' in l: continue
        if re.match(r'^.*\(FAA-S-(ACS|8081)-[\w-]+\)\s+\d+\s*$', l): continue
        m = area_re.match(l)
        if m:
            rn, title = m.group(1), m.group(2)
            if rn not in areas:
                areas[rn] = {'roman': rn, 'title': title, 'tasks': [], 'notes': []}; order.append(rn)
            cur_area = areas[rn]; started=True; field=None
            continue
        if not started: continue
        if stop_re.match(l) and cur_task: break
        m = task_re.match(l)
        if m and cur_area is not None:
            letter, title = m.group(1), m.group(2)
            existing = [t for t in cur_area['tasks'] if t['letter']==letter]
            if existing: cur_task = existing[0]; field=None; continue
            cur_task = {'letter': letter, 'title': title, 'references':'', 'objective':'', 'notes':[], 'elements':[]}
            cur_area['tasks'].append(cur_task); field='title'; last_el=None
            continue
        if cur_task is None: continue
        s = l.strip()
        if s.startswith('References:'):
            cur_task['references'] = s[len('References:'):].strip(); field='references'; continue
        if s.startswith('Objective:'):
            cur_task['objective'] = s[len('Objective:'):].strip(); field='objective'; continue
        if s.startswith('Note:'):
            cur_task['notes'].append(s[5:].strip()); field='note'; continue
        if re.match(r'^(Knowledge|Risk|Management:|Skills?:)', s):
            field='hdr'; continue
        m = el_re.match(l)
        if m:
            code=m.group(1); typ=m.group(4); num=int(m.group(5)); sub=m.group(6); txt=m.group(7).strip()
            if m.group(2)!=cur_area['roman'] or m.group(3)!=cur_task['letter']:
                pass
            txt = re.sub(r'^[a-z]\.\s+','',txt) if sub else txt
            el={'code':code,'type':typ,'num':num,'sub':sub or None,'text':txt}
            cur_task['elements'].append(el); last_el=el; field='el'; continue
        # continuation
        if field=='references': cur_task['references'] += ' '+s
        elif field=='objective': cur_task['objective'] += ' '+s
        elif field=='note' and cur_task['notes']: cur_task['notes'][-1] += ' '+s
        elif field=='el' and last_el: last_el['text'] += ' '+s
        elif field=='title' and not cur_task['references']: cur_task['title'] += ' '+s
    out=[areas[r] for r in order]
    for a in out:
        for t in a['tasks']:
            mm = re.search(r'\(([A-Z, ]+)\)\s*$', t['title'])
            t['classes'] = [c.strip() for c in mm.group(1).split(',')] if mm and all(c.strip() in ('ASEL','AMEL','ASES','AMES','ATP','AMEL, AMES') for c in mm.group(1).split(',')) else None
            t['title']=re.sub(r'\s+',' ',t['title']).strip()
    return out
if __name__=='__main__':
    r=parse_acs(sys.argv[1], sys.argv[2])
    n=sum(len(a['tasks']) for a in r); e=sum(len(t['elements']) for a in r for t in a['tasks'])
    print(len(r),'areas',n,'tasks',e,'elements', file=sys.stderr)
    for a in r:
        print(a['roman'],a['title'])
        for t in a['tasks']: print('   ',t['letter'],t['title'],t['classes'],len(t['elements']), (t['references'][:50]))
