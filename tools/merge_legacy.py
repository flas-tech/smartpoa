"""Merge non-personal standards data from the legacy JPJ checkride management system (Airtable export)
into smartPOA's standards.json. Adds per task: quick (examiner tolerance summary), ksel (knowledge
sub-element sampling rules), exnote (examiner note); per document acs25: cfi_matrix (Test Matrix).
Also writes briefing_requirements.json. Input: a folder of Airtable JSON dumps (not committed)."""
import json, re, sys, os
dump = sys.argv[1] if len(sys.argv) > 1 else '/tmp/dad/dump'
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = json.load(open(os.path.join(root, 'tools/standards.norm.json')))
load = lambda n: [r['fields'] for r in json.load(open(os.path.join(dump, n + '.json')))]
MAP = {'acs6c': '6C', 'acs7b': '7B', 'acs8c': '8C', 'acs11a': '11A', 'acs25': '25'}
stats = {}
fixes = []
for d in S['documents']:
    if d['id'] not in MAP: continue
    rows = {r.get('Task ID', '').strip(): r for r in load('FAA-S-ACS-%s_Task_Data' % MAP[d['id']]) if r.get('Task ID')}
    n = [0, 0, 0]
    for a in d['areas']:
        for t in a['tasks']:
            r = rows.get(a['roman'] + '.' + t['letter'])
            if not r: continue
            q = (r.get('Standards') or '').strip()
            if q:
                stext = ' '.join(e['text'] for e in t['elements'] if e['type'] == 'S')
                # Legacy summaries list engine-inoperative airspeed as +/-5 kt; the ACS skill element says +/-10 kt.
                if re.search(r'airspeed ±10 knots', stext) and re.search(r'AS\s*\+/-\s*5\s*kts', q):
                    q = re.sub(r'AS\s*\+/-\s*5\s*kts', 'AS+/-10kts', q); fixes.append(d['id'] + ' ' + a['roman'] + '.' + t['letter'] + ' airspeed +/-5 -> +/-10 kt (ACS skill element)')
                t['quick'] = q; n[0] += 1
                if not re.search(r'±|\d', stext): t['quick_src'] = 'examiner'
            note = (r.get('Note(s)') or '').strip()
            if not note: continue
            rules = []
            for part in re.split(r';|\n', note):
                m = re.search(r'if\s+([A-Z]\d+)\s*:\s*(\d+)\s+sub-elements', part, re.I)
                if m: rules.append({'parent': m.group(1).upper(), 'n': int(m.group(2))}); continue
                m = re.search(r'([A-Z]\d+)[a-z]\s*-\s*[A-Z]\d+[a-z]\s*:\s*(\d+)', part)
                if m: rules.append({'parent': m.group(1).upper(), 'n': int(m.group(2))}); continue
                m = re.search(r'select\s*:\s*(\d+)\s+sub-elements', part, re.I)
                if m: rules.append({'parent': '*', 'n': int(m.group(1))})
            seen = set(); rules = [r for r in rules if not (r['parent'] in seen or seen.add(r['parent']))]
            if rules: t['ksel'] = rules; n[1] += 1
            else:
                known = ' '.join(t.get('notes') or []).lower()
                if note.lower()[:40] not in known: t['exnote'] = note; n[2] += 1
    stats[d['id']] = n
# CFI test matrix
cfi = next(d for d in S['documents'] if d['id'] == 'acs25')
mx = {}
for r in load('Test Matrix'):
    roman = r.get('Area of Operation')
    for k, v in r.items():
        m = re.match(r'Flight Instructor (ASEL|AMEL) (Initial|Add|Reinstatement)$', k)
        if m and v and v.strip():
            groups = [[x.strip() for x in g.split('|') if x.strip()] for g in v.replace(' ', '').split(',') if g]
            mx.setdefault(m.group(1), {}).setdefault(m.group(2).lower(), {})[roman] = groups
# ACS-25 Appendix 1 Additional Rating Task Table: adding AME to an ASE instructor requires IX Task A only.
if mx.get('AMEL', {}).get('add', {}).get('IX') != [['A']]:
    mx['AMEL']['add']['IX'] = [['A']]; fixes.append('acs25 CFI AMEL added rating IX: A,E -> A (ACS-25 Additional Rating Task Table)')
# Sea classes: substitute water tasks for land-only takeoff/landing picks so 2 takeoffs + 2 landings remain.
SUB = {'C': ['G', 'I', 'K'], 'E': ['G', 'I', 'K'], 'D': ['H', 'J', 'L'], 'F': ['H', 'J', 'L']}
def sea(table):
    out = {}
    for roman, groups in table.items():
        ng = []
        for g in groups:
            if roman == 'VII':
                letters = []
                for l in g:
                    for x in SUB.get(l, [l]):
                        if x not in letters: letters.append(x)
                g = letters
            if roman == 'V' and len(g) > 1 and 'E' not in g: g = sorted(g + ['E'])
            if roman == 'XIV': g = ['B' if l == 'A' else l for l in g]
            ng.append(g)
        out[roman] = ng
    return out
for land, water in (('ASEL', 'ASES'), ('AMEL', 'AMES')):
    mx[water] = {k: sea(v) for k, v in mx[land].items()}
# ACS-25 Appendix 1 tables for instructors adding an airplane class while holding a non-airplane or instrument instructor rating.
# '*' = use the Area of Operation note (the initial selection); None = area not required; a list = those tasks.
ACS_ADD = {
 'ASEL': {'I': 'N', 'II': '*', 'III': {'RH': 'B', 'RG': 'B', 'PL': 'B', 'Glider': 'B'}, 'IV': 'N', 'V': '*', 'VI': {'RG': 'N', 'PL': 'N'}, 'VII': '*',
          'VIII': {'PL': 'N'}, 'IX': {'PL': 'B,F,C|D'}, 'X': '*', 'XI': {'PL': 'N', 'IA': 'N', 'IP': 'N'}, 'XII': '*', 'XIII': 'N', 'XIV': '*'},
 'AMEL': {'I': 'N', 'II': '*', 'III': {'RH': 'B', 'RG': 'B', 'PL': 'B', 'Glider': 'B'}, 'IV': 'N', 'V': '*', 'VI': {'RG': 'N', 'PL': 'N'}, 'VII': '*',
          'VIII': {'PL': 'N'}, 'IX': {'PL': 'A'}, 'X': '*', 'XI': {'PL': 'N', 'IA': 'N', 'IP': 'N'}, 'XII': '*', 'XIII': '*', 'XIV': '*'}}
HELD = ['RH', 'RG', 'PL', 'Glider', 'IA', 'IH', 'IP']
def parse(v): return [[x for x in g.split('|') if x] for g in v.split(',') if g]
for cls, rows in ACS_ADD.items():
    for c in (cls, {'ASEL': 'ASES', 'AMEL': 'AMES'}[cls]):
        init = mx[c]['initial']; byh = {}
        for h in HELD:
            t = {}
            for roman, rule in rows.items():
                r = rule.get(h, '*') if isinstance(rule, dict) else rule
                if r == 'N': continue
                t[roman] = init.get(roman, []) if r == '*' else parse(r)
            byh[h] = t
        mx[c]['add_by_held'] = byh
cfi['cfi_matrix'] = {'source': 'JPJ examiner test matrix (legacy system), checked against FAA-S-ACS-25 Areas of Operation notes and Appendix 1 (Additional Rating Task Table; Renewal/Reinstatement). Sea-class tables substitute water takeoffs and landings.',
                     'classes': mx}
out = json.dumps(S, ensure_ascii=False, separators=(',', ':'))
open(os.path.join(root, 'tools/standards.norm.json'), 'w').write(json.dumps(S, ensure_ascii=False, indent=1))
open(os.path.join(root, 'docs/app/data/standards.json'), 'w').write(out)
# briefing requirements
GR = {'Private Pilot': 'private', 'Commercial Pilot': 'commercial', 'Instrument Rating': 'instrument', 'Flight Instructor': 'cfi', 'Airline Transport Pilot': 'atp'}
br = []
for r in load('Briefing_Requirements'):
    g = (r.get('Grade Certificate Sought') or '').strip()
    split = lambda s: [re.sub(r'^[>\s]+', '- ', x.rstrip()) if x.strip().startswith('>') else x.strip() for x in (s or '').replace('\r', '').split(';\n') for x in [x] if x.strip() and x.strip() != ';']
    br.append({'grade': GR.get(g, g), 'grade_label': g, 'test_type': (r.get('Type of Practical Test') or '').strip(),
               'endorsements': [re.sub(r';$', '', x).strip() for x in split(r.get('Endorsements Required')) if re.sub(r'[;\s]', '', x)],
               'experience': [re.sub(r';$', '', x).rstrip() for x in split(r.get('Aeronautical Experience Required')) if re.sub(r'[;\s]', '', x)]})
TXT = [(r'Failue', 'Failure'), (r'appropriate to taking sought', 'appropriate to the rating sought'),
       (r'^Recommending Instructor is a 2 year$', 'Recommending instructor (initial CFI): held a flight instructor certificate 24 calendar months and given 200 hours of flight training, or meets 61.195(h)(2)(ii) or (iii)'),
       (r'in 61\.65\(c\)$', 'in the areas listed in 61.65(c) - 61.65(d)(2)'), (r'61\.65\(a\)\(3\)\(5\)\)', '61.65(a)(3) and (5)'),
       (r'10 hours instrument training \(at least 5 in ASEL\)', '10 hours instrument training (5 in a single-engine airplane for ASEL; 5 in a multiengine airplane for AMEL)')]
for it in br:
    for k in ('endorsements', 'experience'):
        out = []
        for x in it[k]:
            for line in x.split('\n'):
                line = line.strip().rstrip(';').strip()
                if not line: continue
                if k == 'experience' and line.startswith('3 hours of check ride prep') and it['grade'] == 'commercial': line = '- 3 hours with an authorized instructor in preparation for the practical test within the preceding 2 calendar months (61.129)'
                for a_, b_ in TXT:
                    nl_ = re.sub(a_, b_, line)
                    if nl_ != line: fixes.append('briefing %s / %s: %s' % (it['grade'], it['test_type'], line[:50])); line = nl_
                out.append(line)
        it[k] = out
    # move the commercial 3-hour preparation line under flight training
    if it['grade'] == 'commercial':
        e = it['experience']; prep = [x for x in e if x.startswith('- 3 hours with an authorized')]
        if prep:
            e.remove(prep[0]); i = next((j for j, x in enumerate(e) if 'night cross country' in x), None)
            if i is not None: e.insert(i + 1, prep[0])
br.sort(key=lambda x: (x['grade'], x['test_type']))
json.dump({'source': 'JPJ examiner briefing requirements (legacy system). Examiner checklist, not a substitute for 14 CFR part 61.', 'items': br},
          open(os.path.join(root, 'docs/app/data/briefing_requirements.json'), 'w'), ensure_ascii=False, indent=1)
print('\n'.join(sorted(set(fixes))))
print(stats, {c: {k: len(v) for k, v in t.items()} for c, t in mx.items()}, len(br))
