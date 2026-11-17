"""Extract ACS appendix and PTS introduction requirements, verbatim, into docs/app/data/appendix.json.
Each item carries a 'when' rule the app uses to decide whether it applies to a plan of action.
Source text: pdftotext -layout of the FAA PDFs (same editions as standards.json)."""
import json, re, sys, hashlib
SRC = '/tmp/acs/'
DOCS = {'acs6c': 'private_airplane_acs_6', 'acs7b': 'commercial_airplane_acs_7', 'acs8c': 'instrument_rating_airplane_acs_8',
        'acs11a': 'atp_airplane_acs_11', 'acs25': 'cfi_airplane_acs_25', 'acs15': 'private_helicopter_acs_15',
        'acs16': 'commercial_helicopter_acs_16', 'acs14': 'instrument_helicopter_acs_14', 'pts20': 'atp_helicopter_pts_20',
        'pts15b': 'private_gyroplane_pts_15', 'pts16': 'commercial_gyroplane_pts_16', 'pts9': 'cfi_instrument_pts_9'}
ME, SE = ['AMEL', 'AMES'], ['ASEL', 'ASES']

def norm(s): return re.sub(r'[^a-z0-9]', '', s.lower().replace('’', "'"))
def clean_lines(txt):
    out = []
    for ln in txt.split('\n'):
        s = ln.replace('\f', '').rstrip()
        if re.search(r'\((FAA-S-[A-Z0-9.-]+)\)\s+\d+\s*$', s): continue          # ACS page footer
        if re.match(r'^\s*\d{1,3}\s*$', s): out.append(''); continue          # PTS page number
        if re.match(r'^\s*(Appendix \d+:.*|Table of Contents)\s*$', s) and ln.startswith('\f'): out.append(''); continue
        out.append(s)
    return out
def toc_entries(lines, stop_re):
    ents = []
    for i, ln in enumerate(lines[:400]):
        m = re.match(r'^\s*(.+?)\s*\.{3,}\s*\d+\s*$', ln)
        if m:
            hd = m.group(1).strip().rstrip('.').strip(); prev = lines[i - 1].strip() if i else ''
            # a heading that wraps in the TOC: the first half has no dot leaders
            if prev and not re.search(r'\.{3,}|^Appendix \d|^Table of Contents|^Area of Operation', prev) and (prev.endswith(',') or prev.endswith('and') or prev.endswith('Single-Pilot') or hd[:1].islower() or hd.startswith('Resource') or hd.startswith('Single-Pilot')):
                hd = prev + ' ' + hd
            ents.append((i, hd))
    return ents
def paras(block):
    ps, cur = [], []
    for ln in block:
        if re.match(r'^\s*Appendix \d+: [A-Z][^.]*$', ln) and len(ln.strip()) < 100: ln = ''
        if not ln.strip():
            if cur: ps.append(' '.join(cur)); cur = []
        else: cur.append(ln.strip())
    if cur: ps.append(' '.join(cur))
    return [re.sub(r'\s+', ' ', p).strip() for p in ps if p.strip()]

def find_body(lines, heading, start):
    h = norm(heading)[:40]
    for i in range(start, len(lines)):
        s = lines[i].strip()
        if s and len(s) < 160 and not re.search(r'\.{3,}', s) and (norm(s)[:40] == h or (len(norm(s)) >= 12 and h.startswith(norm(s)[:40]))):
            return i
    return -1

def sections(lines, toc, body_start):
    """Return {heading: [lines]} for every TOC heading found after body_start, in order."""
    pos = []
    last = body_start
    for _, hd in toc:
        i = find_body(lines, hd, last)
        if i >= 0: pos.append((i, hd)); last = i + 1
    out = {}
    for k, (i, hd) in enumerate(pos):
        j = pos[k + 1][0] if k + 1 < len(pos) else min(len(lines), i + 400)
        out[hd] = lines[i + 1:j]
    return out

def task_notes(block):
    """Split 'Operational Requirements, Limitations, & Task Information' into per-task notes keyed ROMAN.LETTER."""
    items, area, cur, title = [], None, None, ''
    buf = []
    def flush():
        if cur and buf: items.append((cur, title, paras(buf)))
    i = 0
    while i < len(block):
        s = block[i].strip()
        ma = re.match(r'^([IVX]+)\.\s+[A-Z][A-Za-z ,&/-]+$', s)
        mt = re.match(r'^Task ([A-Z])\.\s+(.+)$', s)
        if ma and len(s) < 90:
            flush(); buf = []; cur = None; area = ma.group(1)
        elif mt and area:
            flush(); buf = []; cur = area + '.' + mt.group(1); title = mt.group(2)
            # title may wrap to the next non-blank line when it ends inside parentheses
            while i + 1 < len(block) and block[i + 1].strip() and (title.count('(') > title.count(')') or title.count('[') > title.count(']') or title.endswith(' and') or block[i + 1].strip().startswith('(') or block[i + 1].strip().startswith('and ')):
                i += 1; title += ' ' + block[i].strip()
        elif cur: buf.append(block[i])
        i += 1
    flush()
    return items

ROTOR = False
def multi():
    return {'flag': 'me_heli'} if ROTOR else {'cls': ME}
def junk(p):
    letters = [c for c in p if c.isalpha()]
    return (re.match(r'^(Test Number of|Test Code|Code Test Name)', p) or 'REQUIRED AREAS' in p or 'Legend' in p[:200]
            or 'table below' in p or re.search(r'Task [A-Z]: ', p) or (letters and sum(c.isupper() for c in letters) / len(letters) > 0.6 and len(p) > 40))
def when_for(text, head):
    t = text.lower(); w = {}
    if t.startswith('if the aircraft has inoperative'): return {'flag': 'inop'}
    if t.startswith('practical tests conducted in a flight simulation'): return {'flag': 'fstd'}
    if re.search(r'multiengine|vmc|one engine inoperative|engine inoperative', t) and not re.search(r'single-engine land|single engine', t): w.update(multi())
    if 'view limiting' in t or 'view-limiting' in t: w['flag'] = 'instr'
    if 'ballistic parachute' in t: w['flag'] = 'brs'
    if 'does not publish a vmc' in t: w['flag'] = 'novmc'
    return w

def build(doc_id, fname):
    global ROTOR
    ROTOR = doc_id in ('acs15', 'acs16', 'acs14', 'pts20', 'pts15b', 'pts16')
    raw = open(SRC + fname + '.txt', encoding='utf-8', errors='replace').read()
    lines = clean_lines(raw)
    toc = toc_entries(lines, None)
    items = []
    def add(group, head, text, when=None, task=None):
        if not text or len(text) < 25: return
        iid = doc_id + '-' + hashlib.sha1((group + head + text[:80]).encode()).hexdigest()[:8]
        it = {'id': iid, 'group': group, 'head': head, 'text': text}
        if when: it['when'] = when
        if task: it['tasks'] = task if isinstance(task, list) else [task]
        items.append(it)
    acs = doc_id.startswith('acs')
    # end of TOC: last TOC line index
    body_start = (toc[-1][0] + 1) if toc else 0
    if acs:
        # locate appendix heading ranges in the TOC
        app_idx = [i for i, ln in enumerate(lines[:400]) if re.match(r'^Appendix (\d):', ln.strip())]
        groups = []
        for n, i in enumerate(app_idx):
            name = lines[i].strip(); end = app_idx[n + 1] if n + 1 < len(app_idx) else 400
            heads = [h for (k, h) in toc if i < k < end]
            groups.append((name, heads))
        app1_body = next(i for i in range(body_start, len(lines)) if re.match(r'^\s*Appendix 1:', lines[i]) and i > body_start)
        all_heads = [(0, h) for _, hs in groups for h in hs]
        secs = sections(lines, all_heads, app1_body)
        for name, heads in groups:
            short = name.split(':')[0]
            for hd in heads:
                block = secs.get(hd)
                if block is None: continue
                n = norm(hd)
                if short == 'Appendix 1':
                    if n.startswith('eligibilityrequirements'):
                        for p in paras(block):
                            if not junk(p): add(short, hd, p)
                    elif n.startswith('combinedprivateinstrument'):
                        add(short, hd, ' '.join(paras(block)), {'flag': 'combined'})
                    elif n.startswith('additionofan') or n.startswith('additionofa'):
                        cls = [c for c, k in [('ASEL', 'singleengineland'), ('ASES', 'singleenginesea'), ('AMEL', 'multiengineland'), ('AMES', 'multienginesea'), ('RH', 'helicopter'), ('RG', 'gyroplane')] if k in n]
                        pass  # task tables are already applied by the task selection
                    elif n.startswith('removalofthe'):
                        add(short, hd, ' '.join([p for p in paras(block) if not re.search(r'Task [A-Z]: |^[IVX]+\. ', p)][:3]), {'flag': 'limitation'})
                    elif n.startswith('instructorresponsibilities') or n.startswith('evaluatorresponsibilities'):
                        pass
                elif short == 'Appendix 2':
                    w = {}
                    if 'singleandmulti' in n: w = {}
                    elif 'multiengine' in n or 'multipowerplant' in n: w = multi()
                    elif 'singleengine' in n: w = {} if ROTOR else {'cls': SE}
                    add(short, hd, ' '.join(paras(block)), w or None)
                elif short == 'Appendix 3':
                    if n.startswith('operationalrequirementslimitations'):
                        for key, title, ps in task_notes(block):
                            keys = [key] + [key.split('.')[0] + '.' + m for m in re.findall(r'and Task ([A-Z])\.', title)]
                            add(short, 'Task ' + key + ' ' + title, ' '.join(ps), None, keys)
                    else:
                        flag = {'useofflightsimulationtrainingdevicesfstd': 'fstd', 'creditforpilottimeinanfstd': 'fstd_credit', 'useofaviationtrainingdevicesatd': 'atd', 'creditforpilottimeinanatd': 'atd_credit'}
                        f = next((v for k, v in flag.items() if n.startswith(k[:30])), None)
                        if f: add(short, hd, ' '.join(paras(block)), {'flag': f})
                        else:
                            for p in paras(block):
                                if not junk(p): add(short, hd, p, when_for(p, hd) or (multi() if 'singleandmulti' in n and 'multiengine' in p.lower() and not ROTOR else None))
    else:
        keep = [('practicaltestprerequisites', None), ('aircraftandequipmentrequire', 'P'), ('useoffaaapprovedfstd', {'flag': 'fstd'}),
                ('useofflightsimulation', {'flag': 'fstd'}), ('applicantsuseofchecklists', None), ('useofdistractions', None),
                ('positiveexchangeofflightcontrols', None), ('aeronauticaldecisionmaking', None), ('admriskmanagement', None),
                ('emphasisonattitudeinstrument', None), ('multiengine', {'cls': ME}),
                ('additionofaninstrumentratingtoaflightinstructor', {'purpose': ['added_rating']}),
                ('renewalorreinstatementofaflightinstructor', {'purpose': ['reinstatement']}), ('applicantspracticaltestchecklist', 'L')]
        secs = sections(lines, toc, body_start)
        for hd, block in secs.items():
            n = norm(hd)
            rule = next((r for k, r in keep if n.startswith(k)), False)
            if rule is False: continue
            if rule == 'P':
                sub = ''
                for p in paras(block):
                    if junk(p): continue
                    if len(p) < 70 and not p.endswith('.'): sub = p; continue
                    if re.match(r'^(To assist in management|If the practical test involves)', p): sub = ''
                    add('Introduction', hd + (' — ' + sub if sub else ''), p, when_for(p, hd) or None)
            elif rule == 'L':
                its = [re.sub(r'[\ue000-\uf8ff\u25a1\u2610]', '', l).strip().rstrip(':').strip() for l in block]
                its = [x for x in its if x and '__' not in x and not re.match(r'^(Name|Date/Time|Appointment with|Flight Instructor|Rotorcraft|Airline|Applicant|Evaluator)', x)]
                add('Checklists', hd, '; '.join(its[:40]), {'kind': 'list'})
            else:
                txt = ' '.join([p for p in paras(block) if not junk(p)])
                k = txt.find('The renewal or reinstatement')
                add('Introduction', hd, txt[k:] if k > 0 else txt, rule)
    return items

out = {}
for d, f in DOCS.items():
    try: out[d] = build(d, f)
    except Exception as e: print('ERR', d, e, file=sys.stderr); out[d] = []
    for it in out[d]:
        it['text'] = re.split(r'\s*(?:Addition of an [A-Z][^.]*?)?\s*AREA OF OPERATION LEGEND', it['text'])[0]  # PTS rating table after the last paragraph
    for it in out[d]:  # a heading that wraps onto a second line leaves its tail at the start of the text
        hw = it['head'].split(); tw = it['text'].split()
        for k in range(min(5, len(hw)), 0, -1):
            if tw[:k] == hw[-k:] and len(tw) > k + 3: it['text'] = ' '.join(tw[k:]); break
json.dump({'note': 'Verbatim text from the FAA standards; "when" decides applicability in smartPOA.', 'docs': out}, open(sys.argv[1] if len(sys.argv) > 1 else '/tmp/appendix.json', 'w'), indent=1, ensure_ascii=False)
for d, v in out.items(): print(d, len(v), sorted(set(x['group'] for x in v)))
