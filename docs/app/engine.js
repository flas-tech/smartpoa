/* smartPOA engine: pure functions. Standard resolution, required tasks, element sampling,
   scenario + trigger library, question generation and compliance checks. No network access. */
(function (root) {
  'use strict';

  const CLASS_LABEL = { ASEL: 'Airplane Single-Engine Land', AMEL: 'Airplane Multiengine Land', ASES: 'Airplane Single-Engine Sea', AMES: 'Airplane Multiengine Sea', RH: 'Rotorcraft Helicopter', RG: 'Rotorcraft Gyroplane' };
  const CERT_LABEL = { private: 'Private Pilot', commercial: 'Commercial Pilot', instrument: 'Instrument Rating', atp: 'Airline Transport Pilot', cfi: 'Flight Instructor' };
  const PURPOSE_LABEL = { practical_test: 'Practical test', added_rating: 'Added category / class rating', type_rating: 'Aircraft type rating', retest: 'Retest (after disapproval)', mock_checkride: 'Mock checkride', training: 'Training / stage check', continuation: 'Continuation (after discontinuance)', reinstatement: 'Flight instructor reinstatement' };
  const HELD_OPTIONS = ['ASEL', 'ASES', 'AMEL', 'AMES', 'RH', 'RG', 'Glider', 'Balloon', 'Airship', 'PL', 'IA', 'IH', 'IP'];

  // ---------- standard resolution ----------
  function categoryOfClass(cls) { return cls === 'RH' ? 'rotorcraft-helicopter' : cls === 'RG' ? 'rotorcraft-gyroplane' : 'airplane'; }

  function resolveStandard(docs, profile) {
    const cert = profile.cert;
    let cat = categoryOfClass(profile.cls);
    if (cert === 'instrument' && profile.cls === 'RG') return { error: 'There is no instrument rating for gyroplanes.' };
    if (cert === 'atp' && profile.cls === 'RG') return { error: 'There is no ATP certificate for gyroplanes.' };
    if (cert === 'cfi' && cat !== 'airplane') return { error: 'Only the Flight Instructor Airplane ACS (FAA-S-ACS-25) is on file. Use the rotorcraft flight instructor PTS directly for now.' };
    if (profile.purpose === 'reinstatement' && cert !== 'cfi') return { error: 'Reinstatement applies to the flight instructor certificate only.' };
    const doc = docs.find((d) => d.cert === cert && d.category === cat);
    if (!doc) return { error: 'No ACS or PTS on file for this certificate and category.' };
    return { doc };
  }

  function taskKey(area, task) { return area.roman + '.' + task.letter; }
  function elementCodes(doc, area, task) {
    // PTS objective items have no FAA codes; synthesize stable local references.
    return task.elements.map((e, i) => e.code || (doc.num.replace(/^FAA-S-/, '') + '.' + area.roman + '.' + task.letter + '.' + e.num + (e.sub || '')));
  }

  // CFI test matrix: per Area a list of groups; a group with several letters means choose one.
  function cfiMatrix(doc, profile) {
    const m = doc.cfi_matrix; if (!m) return null;
    const cls = profile.cls;
    const kind = profile.purpose === 'reinstatement' ? 'reinstatement' : profile.purpose === 'added_rating' ? 'add' : 'initial';
    const c = m.classes[cls] || {};
    const byHeld = kind === 'add' && profile.held && c.add_by_held && c.add_by_held[profile.held];
    const t = byHeld || c[kind];
    if (!t) return null;
    const sea = profile.cls === 'ASES' || profile.cls === 'AMES';
    return { kind, table: t, sea };
  }
  function pickGroup(group, area, usage, rand, pinned) {
    if (group.length === 1) return group[0];
    const p = group.find((l) => pinned && pinned.has(area.roman + '.' + l)); if (p) return p;
    const score = (l) => { const t = area.tasks.find((x) => x.letter === l); return t ? t.elements.reduce((a, e) => a + (usage[e.code] || 0), 0) / Math.max(1, t.elements.length) : 99; };
    return group.map((l) => ({ l, u: score(l), r: rand() })).sort((a, b) => a.u - b.u || a.r - b.r)[0].l;
  }

  // Which tasks are required, with a reason for each.
  function requiredTasks(doc, profile, opts) {
    opts = opts || {};
    const out = [];
    const cls = profile.cls;
    const isAirplane = doc.category === 'airplane';
    let addl = null;
    if (profile.purpose === 'added_rating' && profile.held && doc.additional_rating && doc.additional_rating[cls]) {
      addl = doc.additional_rating[cls][profile.held] || null;
    }
    const mx = doc.cert === 'cfi' ? cfiMatrix(doc, profile) : null;
    const usage = opts.usage || {}; const rand = opts.rand || Math.random; const pinned = (opts.pinned || profile.cfiPicks) ? new Set(opts.pinned || profile.cfiPicks) : null;
    const KIND = { initial: 'initial certificate', add: 'added class rating', reinstatement: 'reinstatement' };
    for (const area of doc.areas) {
      let picks = null;
      if (mx) {
        const fits = (l) => { const tk = area.tasks.find((x) => x.letter === l); return tk && (!isAirplane || !tk.classes || tk.classes.includes(cls)); };
        const groups = (mx.table[area.roman] || []).map((g) => g.filter(fits)).filter((g) => g.length);
        picks = {};
        groups.forEach((g) => { const gg = mx.sea && area.roman === 'XIV' ? g.map((l) => (l === 'A' ? 'B' : l)) : g; const l = pickGroup(gg, area, usage, rand, pinned); picks[l] = gg.length > 1 ? 'Chosen from ' + gg.map((x) => area.roman + '.' + x).join(' / ') + ' (choose one; least recently tested)' : 'Required'; });
      }
      for (const task of area.tasks) {
        let req = true; let reason = 'Required for the certificate/rating sought';
        if (picks) {
          if (picks[task.letter]) reason = picks[task.letter] + ' for a flight instructor ' + KIND[mx.kind] + ' (' + profile.cls + ') per the Area of Operation note in ' + doc.num;
          else { req = false; reason = (Object.keys(picks).length ? 'Not selected' : 'Area not required') + ' for a flight instructor ' + KIND[mx.kind] + ' (' + profile.cls + ') per the Area of Operation note in ' + doc.num; }
        }
        if (isAirplane && task.classes && !task.classes.includes(cls)) { req = false; reason = 'Applies only to ' + task.classes.join(', '); }
        if (req && doc.id === 'acs11a' && task.flags.includes('ATP') && profile.purpose === 'type_rating' && !profile.atpCert) { req = false; reason = 'ATP certificate only — not required for an aircraft type rating alone'; }
        if (req && addl && !picks) {
          const c = addl[area.roman];
          if (!c || c.none) { req = false; reason = 'Not required for an added rating when the applicant holds ' + profile.held + ' (Additional Rating Task Table)'; }
          else if (c.tasks && !c.tasks.includes(task.letter)) { req = false; reason = 'Not listed for this Area in the Additional Rating Task Table (held: ' + profile.held + ')'; }
          else if (c.star) reason = 'Additional Rating Task Table: follow the selection requirements in the body of the standard';
          else reason = 'Required by the Additional Rating Task Table (held: ' + profile.held + ')';
        }
        if (req && (profile.purpose === 'retest' || profile.purpose === 'continuation') && profile.retestTasks && profile.retestTasks.length) {
          const cont = profile.purpose === 'continuation';
          if (!profile.retestTasks.includes(taskKey(area, task))) { req = false; reason = cont ? 'Completed satisfactorily before the discontinuance (credit per the Letter of Discontinuance)' : 'Passed on the previous attempt (examiner may re-evaluate any task)'; }
          else reason = cont ? 'Not yet completed when the test was discontinued' : 'Failed or not completed on the previous attempt';
        }
        out.push({ key: taskKey(area, task), area, task, required: req, reason });
      }
    }
    return out;
  }

  // ---------- element sampling ----------
  // Picks the minimum required elements and rotates K/R picks toward the least-used ones.
  function selectElements(doc, area, task, opts) {
    const codes = elementCodes(doc, area, task);
    const aktr = new Set((opts.aktr || []).map((c) => c.trim().toUpperCase()));
    const usage = opts.usage || {};
    const rand = opts.rand || Math.random;
    const els = task.elements.map((e, i) => Object.assign({}, e, { ref: codes[i] }));
    const sel = new Set();
    const why = {};
    if (doc.kind === 'PTS') {
      els.forEach((e) => { sel.add(e.ref); why[e.ref] = 'PTS objective item'; });
      return { selected: Array.from(sel), why };
    }
    // a parent element with sub-items (K2 with K2a, K2b) is represented by its sub-items for sampling
    const leaf = (e) => !els.some((x) => x.type === e.type && x.num === e.num && x.sub) || e.sub;
    els.forEach((e) => { if (aktr.has(e.ref.toUpperCase()) || (e.sub == null && Array.from(aktr).some((a) => a.startsWith(e.ref.toUpperCase())))) { sel.add(e.ref); why[e.ref] = 'Knowledge test deficiency (AKTR)'; } });
    els.filter((e) => e.type === 'S' && leaf(e)).forEach((e) => { sel.add(e.ref); why[e.ref] = why[e.ref] || 'All skill elements'; });
    for (const t of ['K', 'R']) {
      const pool = els.filter((e) => e.type === t && leaf(e));
      if (!pool.length) continue;
      if (pool.some((e) => sel.has(e.ref))) continue;
      const want = Math.min(pool.length, t === 'K' ? (opts.kCount || 1) : (opts.rCount || 1));
      const ranked = pool.map((e) => ({ e, u: usage[e.ref] || 0, r: rand() })).sort((a, b) => a.u - b.u || a.r - b.r).slice(0, want);
      ranked.forEach(({ e }) => { sel.add(e.ref); why[e.ref] = t === 'K' ? 'Knowledge sample (least recently tested)' : 'Risk management sample (least recently tested)'; });
    }
    // examiner sampling rules (e.g. "If K2: 3 sub-elements"): expand a chosen parent to n of its sub-elements
    (task.ksel || []).forEach((rule) => {
      const parents = new Set(els.filter((e) => e.sub && sel.has(e.ref)).map((e) => e.type + e.num));
      parents.forEach((pk) => {
        if (rule.parent !== '*' && rule.parent !== pk) return;
        const subs = els.filter((e) => e.sub && e.type + e.num === pk);
        const have = subs.filter((e) => sel.has(e.ref)).length;
        const add = subs.filter((e) => !sel.has(e.ref)).map((e) => ({ e, u: usage[e.ref] || 0, r: rand() })).sort((a, b) => a.u - b.u || a.r - b.r).slice(0, Math.max(0, Math.min(subs.length, rule.n) - have));
        add.forEach(({ e }) => { sel.add(e.ref); why[e.ref] = 'Examiner sampling rule: ' + rule.n + ' sub-elements of ' + pk; });
      });
    });
    return { selected: Array.from(sel), why };
  }

  // ---------- scenario templates ----------
  const MISSIONS = {
    private: [
      { name: 'Weekend cross-country with a passenger', text: 'You are taking a non-pilot friend to {dest} for the weekend and returning Sunday afternoon. Your friend has an evening commitment and is eager to get there on time. Plan the flight, including fuel, weight and balance with two adults and baggage, and an alternate if the destination becomes unavailable.' },
      { name: 'Family trip to a non-towered field', text: 'You plan to fly two family members to {dest}, a non-towered airport, for lunch. One passenger is nervous about flying. Brief the passengers, plan the route through the airspace along the way, and identify where you would divert.' },
    ],
    commercial: [
      { name: 'Aerial photography flight', text: 'A real estate company has hired you to photograph properties near {dest}. The photographer will be on board with camera equipment. Determine whether this operation is permitted under your commercial privileges, plan the flight and fuel, and assess the risks of low-altitude maneuvering over the property.' },
      { name: 'Aircraft ferry for an owner', text: 'An owner asks you to ferry their aircraft from {dep} to {dest} for maintenance. One item of equipment is placarded inoperative. Determine airworthiness, plan the route, and explain the decisions you would make if weather deteriorates.' },
    ],
    instrument: [
      { name: 'IFR business trip', text: 'You are flying IFR from {dep} to {dest} for a morning meeting. Forecast conditions at the destination are near approach minimums with improvement later. File the flight plan, select an alternate that meets the regulatory requirements, and brief the expected approach and missed approach.' },
      { name: 'Hard IFR with icing potential', text: 'A trip from {dep} to {dest} requires flight through a layer with freezing levels near your planned altitude. Plan the flight and altitudes, identify escape options, and explain the conditions under which you would cancel or divert.' },
    ],
    atp: [
      { name: 'Two-crew charter-style trip', text: 'You are captain for a two-crew trip from {dep} to {dest} with passengers. The first officer is new to the type. Brief crew duties, compute takeoff performance for the conditions, and plan for an engine failure during the departure.' },
      { name: 'Type rating line-oriented scenario', text: 'Plan a line-oriented flight from {dep} to {dest} in the {aircraft}. The aircraft is dispatched with one MEL item. Review the MEL procedures, compute performance and weight and balance, and brief the departure, arrival and expected approach.' },
    ],
    cfi: [
      { name: 'Teaching a cross-country lesson', text: 'You are preparing a student pilot for the first solo cross-country to {dest}. Teach the planning lesson as you would to the student, including weather, fuel, airspace along the route and the endorsements the student needs, then fly the trip demonstrating and explaining the maneuvers and the common errors a student would make.' },
      { name: 'Commercial maneuvers student', text: 'A private pilot working toward a commercial certificate has struggled with chandelles and steep spirals. Plan a lesson from {dep} that diagnoses the errors, teaches the maneuvers using the fundamentals of instructing, and manages the risks of training flight near the practice area.' },
      { name: 'Flight review for a returning pilot', text: 'A pilot who has not flown in three years asks you for a flight review in the {aircraft}. Plan the ground and flight content, the regulations that apply, and how you would decide whether to endorse the logbook.' },
    ],
    helicopter: [
      { name: 'Site survey with off-airport landing', text: 'A construction company has asked you to fly a project manager to survey a site near {dest} and land in a confined area at the site. Plan the flight, evaluate the landing zone, and compute performance for the expected density altitude.' },
      { name: 'Utility patrol flight', text: 'You will fly a low-level patrol along a pipeline route from {dep}. Plan the flight, wire and obstacle awareness, and the decisions you would make for weather or a mechanical problem far from an airport.' },
    ],
    gyroplane: [
      { name: 'Local scenic flight', text: 'You will take a passenger on a local scenic flight from {dep} over the coastline and return. Plan the flight, brief the passenger, and identify suitable emergency landing areas along the route.' },
    ],
  };
  function missionsFor(profile) {
    if (profile.cls === 'RH') return MISSIONS.helicopter.concat(profile.cert === 'instrument' ? MISSIONS.instrument : []);
    if (profile.cls === 'RG') return MISSIONS.gyroplane;
    return MISSIONS[profile.cert] || MISSIONS.private;
  }
  function scenarioProfile(settings, cert) {
    const p = settings && settings.scenario_profiles; return (p && (p[cert] || p.default)) || null;
  }

  // Trigger events. `match` runs against task titles so one library works across every ACS/PTS.
  const TRIGGERS = [
    { id: 'inop', phase: 'Preflight', name: 'Inoperative equipment found', text: 'During preflight the applicant finds an item of equipment inoperative (e.g., a landing light or one fuel gauge). Applicant must decide whether the flight may legally depart.', match: /Airworthiness|Preflight Inspection|Operation of Systems/i },
    { id: 'wxchange', phase: 'Planning', name: 'Updated weather shows deterioration', text: 'An updated forecast shows the destination dropping toward minimums near the ETA. Applicant re-evaluates the go/no-go decision and alternates.', match: /Weather Information|Cross-Country Flight Planning|Flight Planning|Weather/i },
    { id: 'pax', phase: 'Preflight', name: 'Passenger pressure / get-there-itis', text: 'The simulated passenger pushes to depart on time despite a concern. Applicant manages external pressure and briefs the passenger.', match: /Single-Pilot Resource|Human Factors|Flight Deck Management|Cockpit Management|Passenger|Crew Resource/i },
    { id: 'wb', phase: 'Planning', name: 'Out-of-limits weight and balance', text: 'Late-arriving baggage puts the aircraft out of CG limits. Applicant recomputes and resolves the problem.', match: /Performance and Limitations|Weight and Balance/i },
    { id: 'divert', phase: 'Enroute', name: 'Diversion', text: 'Enroute, the evaluator introduces a reason to divert (passenger illness, weather, closed runway). Applicant selects an airport, computes heading, time and fuel, and proceeds.', match: /Diversion/i },
    { id: 'lost', phase: 'Enroute', name: 'Lost procedures', text: 'Applicant is told the GPS has failed and position is uncertain. Applicant uses lost procedures and available resources.', match: /Lost Procedures/i },
    { id: 'elec', phase: 'Enroute', name: 'Electrical or system malfunction', text: 'Simulated alternator/generator failure or another system malfunction. Applicant runs the checklist, sheds load and decides where to land.', match: /Systems and Equipment Malfunctions|Malfunction|Abnormal|Electrical/i },
    { id: 'engfail', phase: 'Enroute', name: 'Engine failure (simulated)', text: 'Simulated power loss at a safe altitude. Applicant establishes best glide, selects a field and completes the emergency checklist.', match: /Emergency Approach and Landing|Power Failure|Engine Failure/i },
    { id: 'efato', phase: 'Departure', name: 'Engine failure after takeoff (multiengine)', text: 'At a safe altitude after takeoff the evaluator simulates engine failure. Applicant maintains control, identifies, verifies and feathers (simulated).', match: /Engine Failure After Lift-?off|Engine Failure During Takeoff|Engine Failure .*Takeoff|Maneuvering with One Engine|One Engine Inoperative|Vmc/i },
    { id: 'emdesc', phase: 'Enroute', name: 'Emergency descent', text: 'A simulated cabin fire, smoke or pressurization problem requires an emergency descent.', match: /Emergency Descent/i },
    { id: 'goaround', phase: 'Arrival', name: 'Go-around / rejected landing', text: 'A simulated runway incursion on short final requires a go-around.', match: /Go-Around|Rejected Landing|Balked Landing/i },
    { id: 'shortfield', phase: 'Arrival', name: 'Short or soft runway at destination', text: 'The destination runway is short or unpaved. Applicant computes performance and uses the appropriate technique.', match: /Short-Field|Soft-Field|Confined Area|Pinnacle|Platform/i },
    { id: 'stall', phase: 'Maneuvers', name: 'Slow flight and stall awareness', text: 'Applicant is asked to slow behind traffic and maneuver near the critical angle of attack, then recover from stalls as directed.', match: /Slow Flight|Stall|Spin Awareness/i },
    { id: 'steep', phase: 'Maneuvers', name: 'Traffic avoidance steep turn', text: 'Applicant performs steep turns as an avoidance maneuver while maintaining altitude.', match: /Steep Turn|Steep Spiral|Chandelle|Lazy Eight|Power-Off 180|Eights on Pylons/i },
    { id: 'gref', phase: 'Maneuvers', name: 'Ground reference work', text: 'Applicant performs ground reference maneuvers while maintaining wind-drift correction and traffic awareness.', match: /Ground Reference|Rectangular Course|S-Turns|Turns Around a Point/i },
    { id: 'night', phase: 'Arrival', name: 'Night arrival planning', text: 'The return flight will end after dark. Applicant discusses night preparation, lighting and illusions.', match: /Night/i },
    { id: 'partial', phase: 'Instrument', name: 'Primary instrument failure', text: 'The evaluator covers the attitude/heading displays. Applicant continues on partial panel and completes the approach.', match: /Loss of Primary|Partial Panel|Unusual Flight Attitudes|Recovery from Unusual/i },
    { id: 'hold', phase: 'Instrument', name: 'ATC hold and reroute', text: 'ATC issues an amended clearance and a hold at a fix. Applicant copies, sets up and flies the hold.', match: /Holding|Compliance with Departure|Air Traffic Control Clearances|Compliance with ATC|Clearances/i },
    { id: 'npa', phase: 'Instrument', name: 'Non-precision approach', text: 'Weather at the airport requires a non-precision approach (e.g., RNAV LNAV or VOR).', match: /Nonprecision|Non-precision/i },
    { id: 'pa', phase: 'Instrument', name: 'Precision approach', text: 'Applicant flies an ILS or LPV approach to minimums.', match: /Precision Approach|^Precision/i },
    { id: 'missed', phase: 'Instrument', name: 'Missed approach', text: 'At minimums the runway environment is not in sight. Applicant executes the published missed approach.', match: /Missed Approach/i },
    { id: 'circle', phase: 'Instrument', name: 'Circle to land', text: 'Wind favors a runway without a straight-in approach. Applicant circles to land.', match: /Circling/i },
    { id: 'oei_app', phase: 'Instrument', name: 'Approach with an inoperative engine', text: 'Simulated engine failure before or during the approach. Applicant flies the approach with one engine inoperative.', match: /Inoperative Engine|One Engine Inoperative/i },
    { id: 'icing', phase: 'Enroute', name: 'Unforecast icing', text: 'Applicant is told light rime ice is accumulating. Applicant explains and applies the escape plan.', match: /Icing|Ice/i },
    { id: 'highalt', phase: 'Enroute', name: 'High-altitude operations', text: 'Applicant explains supplemental oxygen and pressurization requirements for the planned altitude.', match: /Supplemental Oxygen|Pressurization|High-Altitude/i },
    { id: 'rto', phase: 'Departure', name: 'Rejected takeoff', text: 'The evaluator calls for a rejected takeoff at a safe speed.', match: /Rejected Takeoff|Aborted Takeoff/i },
    { id: 'upset', phase: 'Maneuvers', name: 'Upset recovery', text: 'Applicant recovers from an unusual attitude or upset induced by the evaluator.', match: /Upset|Unusual Attitude/i },
    { id: 'glassy', phase: 'Arrival', name: 'Glassy or rough water landing (seaplane)', text: 'Conditions at the landing area are glassy (or rough). Applicant selects the appropriate technique.', match: /Glassy Water|Rough Water|Confined-Area Takeoff and Maximum|Seaplane/i },
    { id: 'dock', phase: 'Postflight', name: 'Docking and mooring', text: 'Applicant approaches the dock with a crosswind and secures the seaplane.', match: /Docking|Mooring|Anchoring|Ramping|Beaching|Taxiing and Sailing/i },
    { id: 'auto', phase: 'Emergency', name: 'Autorotation (helicopter)', text: 'Simulated engine failure. Applicant enters autorotation and selects a landing area.', match: /Autorotation/i },
    { id: 'vrs', phase: 'Emergency', name: 'Settling with power / vortex ring state', text: 'Applicant describes and recovers from the onset of vortex ring state.', match: /Vortex Ring|Settling-with-Power|Settling With Power/i },
    { id: 'ltail', phase: 'Emergency', name: 'Antitorque system failure', text: 'Applicant explains and performs (simulated) procedures for an antitorque system failure.', match: /Antitorque|Tail Rotor/i },
    { id: 'lowrpm', phase: 'Emergency', name: 'Low rotor RPM', text: 'Applicant recognizes and recovers from low rotor RPM.', match: /Low Rotor|Rotor RPM/i },
    { id: 'dyn', phase: 'Emergency', name: 'Dynamic rollover', text: 'During a slope or crosswind hover, applicant explains dynamic rollover recognition and recovery.', match: /Dynamic Rollover|Slope/i },
    { id: 'hover', phase: 'Maneuvers', name: 'Hover and hover taxi work', text: 'Applicant hovers, hover taxis and turns over a point in the wind conditions present.', match: /Hover|Air Taxi|Surface Taxi|Slope Operations/i },
    { id: 'gres', phase: 'Emergency', name: 'Ground resonance (gyroplane)', text: 'Applicant explains and demonstrates prevention of ground resonance.', match: /Ground Resonance|Lift-Off at Low Airspeed|High Rate of Descent/i },
  ];
  const PLANNING_MATCH = /Pilot Qualifications|Certificates and Documents|Airworthiness|Weather|Cross-Country|Flight Planning|National Airspace|Performance and Limitations|Operation of Systems|Human Factors|Aeromedical|Water and Seaplane|Night Preparation|Preflight Assessment|Navigation Systems|Air Traffic Control Clearances|Instrument Flight Planning|Aircraft Flight Instruments|Flight Deck Check|Preflight Inspection|Flight Deck Management|Engine Starting|Taxiing|Before Takeoff|Communications|Traffic Patterns|Airport and|After Landing|Parking|Securing|Postflight|Checking Instruments|Pilotage|Dead Reckoning|Navigation and Radar|Crew Resource|Single-Pilot/i;

  function triggersFor(tasks) {
    const titles = tasks.filter((t) => t.required).map((t) => t.task.title_plain || t.task.title);
    return TRIGGERS.filter((tr) => titles.some((t) => tr.match.test(t)));
  }
  function triggerCovers(tr, tasks) { return tasks.filter((t) => t.required && tr.match.test(t.task.title_plain || t.task.title)).map((t) => t.key); }

  function scenarioCoverage(tasks, scenario) {
    const covered = new Set();
    const req = tasks.filter((t) => t.required);
    if (scenario && scenario.mission && scenario.mission.trim().length > 30) {
      req.forEach((t) => { if (PLANNING_MATCH.test(t.task.title_plain || t.task.title)) covered.add(t.key); });
    }
    (scenario && scenario.triggers || []).forEach((tr) => (tr.covers || []).forEach((k) => covered.add(k)));
    (scenario && scenario.extraCovered || []).forEach((k) => covered.add(k));
    return { covered: req.filter((t) => covered.has(t.key)).map((t) => t.key), total: req.length };
  }

  // ---------- questions ----------
  function lc(s) { s = String(s || '').trim().replace(/\.$/, ''); return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function questionFor(el, ctx) {
    const sc = ctx.scenarioName ? ' in today’s scenario (' + ctx.scenarioName + ')' : '';
    const ac = ctx.aircraft ? ' in the ' + ctx.aircraft : '';
    const t = String(el.text || '');
    if (el.type === 'K') {
      if (/:$/.test(t)) return { portion: 'oral', prompt: 'Describe the following as it applies to this flight' + sc + ': ' + lc(t.replace(/:$/, '')) + '.' };
      return { portion: 'oral', prompt: 'Explain ' + lc(t) + (sc ? ', and how it affects your plan' + sc : '') + '.' };
    }
    if (el.type === 'R') {
      return { portion: 'scenario', prompt: 'How would you identify, assess and mitigate the risk of ' + lc(t.replace(/:$/, '')) + sc + '? What would make you change the plan?' };
    }
    if (el.type === 'S') return { portion: 'flight', prompt: 'Flight: ' + t.replace(/\s+/g, ' ') + (ac && !/airplane|helicopter|gyroplane/i.test(t) ? '' : '') };
    return { portion: 'oral', prompt: 'Demonstrate/explain: ' + t };
  }

  // ---------- compliance ----------
  function similarity(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0; a.forEach((x) => { if (b.has(x)) inter++; });
    return inter / (a.size + b.size - inter);
  }

  function complianceChecks(ctx) {
    // ctx: { doc, profile, tasks(requiredTasks with .selected/.included), content, priorPoas[], aktr[], regs, docStatus, eligibility }
    const { doc, profile, content } = ctx;
    const included = new Set(Object.keys(content.tasks || {}).filter((k) => content.tasks[k].included));
    const req = ctx.tasks.filter((t) => t.required);
    const missing = req.filter((t) => !included.has(t.key));
    const isACS = doc.kind === 'ACS';
    const rows = [];
    const push = (id, quoteKey, cite, url, status, evidence) => rows.push({ id, quoteKey, cite, url, status, evidence });
    const stdUrl = doc.url;

    push('cfr_61_43', null, '14 CFR 61.43(a)(1)', 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/section-61.43', missing.length ? 'gap' : 'met',
      missing.length ? missing.length + ' required task(s) not in the plan: ' + missing.map((t) => t.key).join(', ') : 'All ' + req.length + ' required tasks from ' + doc.num + ' are in the plan.');
    push('poa_all', isACS ? 'acs_poa' : 'o895d_ms_i', isACS ? doc.num + ', Introduction' : 'FAA Order 8000.95D', isACS ? stdUrl : null, missing.length ? 'gap' : 'met',
      req.length + ' required tasks across ' + new Set(req.map((t) => t.area.roman)).size + ' Areas of Operation; ' + (req.length - missing.length) + ' included.');
    if (isACS && doc.category === 'airplane') {
      const wrong = Array.from(included).map((k) => ctx.tasks.find((t) => t.key === k)).filter((t) => t && t.task.classes && !t.task.classes.includes(profile.cls));
      push('class', 'acs_class', doc.num + ', Introduction', stdUrl, wrong.length ? 'review' : 'met',
        'Class used for the test: ' + profile.cls + '. ' + (wrong.length ? wrong.length + ' included task(s) belong to another class: ' + wrong.map((t) => t.key).join(', ') + '.' : 'Class-specific tasks match the class airplane.'));
    }
    if (doc.cfi_matrix && profile.cert === 'cfi') {
      const m = cfiMatrix(doc, profile);
      push('cfi_areas', 'acs_poa', doc.num + ', Areas of Operation notes', stdUrl, m ? 'met' : 'review', m ? 'Tasks follow the Area of Operation notes for a flight instructor ' + m.kind + ' (' + profile.cls + '), with one task chosen where the note allows a choice.' : 'No flight instructor task selection on file for this class; all tasks treated as required. Confirm with the standard.');
    }
    if (profile.purpose === 'added_rating' && !(doc.cert === 'cfi')) {
      const tbl = doc.additional_rating && doc.additional_rating[profile.cls] && doc.additional_rating[profile.cls][profile.held];
      push('addl', null, doc.num + ', Additional Rating Task Table', stdUrl, tbl ? 'met' : 'review',
        tbl ? 'Required tasks were taken from the Additional Rating Task Table for adding ' + profile.cls + ' with ' + profile.held + ' held.' : 'No Additional Rating Task Table entry for this combination; all tasks are treated as required. Confirm with the standard.');
    }
    if (isACS) {
      let kMiss = [], rMiss = [], sMiss = [], aMiss = [];
      const aktr = new Set((ctx.aktr || []).map((c) => c.toUpperCase()));
      req.forEach((t) => {
        const c = content.tasks[t.key]; if (!c || !c.included) return;
        const sel = new Set((c.elements || []).map((x) => x.toUpperCase()));
        const els = t.task.elements;
        const leaf = (e) => !els.some((x) => x.type === e.type && x.num === e.num && x.sub) || e.sub;
        const hasType = (ty) => els.some((e) => e.type === ty);
        const selType = (ty) => els.some((e) => e.type === ty && sel.has(e.code.toUpperCase()));
        if (hasType('K') && !selType('K')) kMiss.push(t.key);
        if (hasType('R') && !selType('R')) rMiss.push(t.key);
        els.filter((e) => e.type === 'S' && leaf(e)).forEach((e) => { if (!sel.has(e.code.toUpperCase())) sMiss.push(e.code); });
        els.forEach((e) => { if (aktr.has(e.code.toUpperCase()) && !sel.has(e.code.toUpperCase())) aMiss.push(e.code); });
      });
      const aktrInScope = Array.from(aktr).filter((c) => req.some((t) => t.task.elements.some((e) => e.code.toUpperCase() === c)));
      push('min_k', 'acs_min', doc.num + ', Introduction', stdUrl, kMiss.length ? 'gap' : 'met', kMiss.length ? 'No knowledge element selected in: ' + kMiss.join(', ') : 'At least one knowledge element selected in every included task that has one.');
      push('min_r', 'acs_min', doc.num + ', Introduction', stdUrl, rMiss.length ? 'gap' : 'met', rMiss.length ? 'No risk management element selected in: ' + rMiss.join(', ') : 'At least one risk management element selected in every included task that has one.');
      push('min_s', 'acs_min', doc.num + ', Introduction', stdUrl, sMiss.length ? 'review' : 'met', sMiss.length ? sMiss.length + ' skill element(s) not selected (allowed only where the standard says otherwise): ' + sMiss.slice(0, 12).join(', ') + (sMiss.length > 12 ? '…' : '') : 'All skill elements selected.');
      push('aktr', 'acs_aktr', doc.num + ', Introduction', stdUrl, aMiss.length ? 'gap' : 'met',
        (ctx.aktr || []).length ? (aMiss.length ? 'AKTR codes not yet in the plan: ' + aMiss.join(', ') : aktrInScope.length + ' AKTR code(s) in scope, all included.' + ((ctx.aktr || []).length > aktrInScope.length ? ' ' + ((ctx.aktr || []).length - aktrInScope.length) + ' code(s) belong to tasks not on this test.' : '')) : 'No AKTR deficiency codes recorded for this applicant. Record them on the applicant if the knowledge test report lists any.');
    } else {
      const ack = !!(content.attest && content.attest.special_emphasis);
      push('sei', 'o895d_pm_b', 'FAA Order 8000.95D', null, ack ? 'attested' : 'gap', ack ? 'Examiner attests special emphasis items will be evaluated throughout the test.' : 'Confirm special emphasis items on the Review step.');
    }
    push('written', 'o895d_pm_a', 'FAA Order 8000.95D', null, 'met', 'This written plan of action was prepared for this applicant using ' + doc.num + '.');
    const cov = scenarioCoverage(ctx.tasks, content.scenario || {});
    const pct = cov.total ? Math.round(100 * cov.covered.length / cov.total) : 0;
    const hasMission = content.scenario && content.scenario.mission && content.scenario.mission.trim().length > 30;
    push('scenario', 'o895d_ms_ii', 'FAA Order 8000.95D', null, !hasMission ? 'gap' : pct >= 50 ? 'met' : 'review',
      hasMission ? 'Scenario with ' + ((content.scenario.triggers || []).length) + ' planned event(s) covers ' + cov.covered.length + ' of ' + cov.total + ' required tasks (' + pct + '%).' : 'No scenario written yet.');
    const qs = content.questions || [];
    const scen = qs.filter((q) => q.portion === 'scenario' || /scenario/i.test(q.prompt)).length;
    push('sbt', 'o895d_pm_c', 'FAA Order 8000.95D', null, qs.length && scen ? 'met' : 'review', qs.length + ' planned question(s)/prompts; ' + scen + ' scenario-based.');
    const b = content.briefings || {};
    const bOk = ['pretest', 'preflight', 'postflight'].filter((k) => b[k] && b[k].trim().length > 20);
    push('brief', 'o895d_ms_iii', 'FAA Order 8000.95D', null, bOk.length === 3 ? 'met' : 'gap', 'Briefings present: ' + (bOk.length ? bOk.join(', ') : 'none') + '.');
    // uniqueness vs prior plans
    const mine = new Set(Object.keys(content.tasks || {}).flatMap((k) => (content.tasks[k].included ? (content.tasks[k].elements || []) : [])));
    let maxSim = 0, maxTitle = '';
    (ctx.priorPoas || []).forEach((p) => {
      const els = new Set(Object.keys((p.content && p.content.tasks) || {}).flatMap((k) => (p.content.tasks[k].included ? (p.content.tasks[k].elements || []) : [])));
      let s = similarity(mine, els);
      if (p.content && p.content.scenario && content.scenario && p.content.scenario.mission && p.content.scenario.mission === content.scenario.mission) s = Math.max(s, 0.95);
      if (s > maxSim) { maxSim = s; maxTitle = p.title || ''; }
    });
    push('unique', 'o895d_ms_8', 'FAA Order 8000.95D', null, maxSim > 0.9 ? 'review' : 'met',
      (ctx.priorPoas || []).length ? 'Highest overlap with your previous ' + (ctx.priorPoas || []).length + ' plan(s): ' + Math.round(maxSim * 100) + '%' + (maxTitle ? ' (' + maxTitle + ')' : '') + '. Plans above 90% are flagged.' : 'No earlier plans to compare.');
    push('current', 'o895d_current', 'FAA Order 8000.95D', null, ctx.docStatus === 'current' ? 'met' : 'review',
      doc.num + ' (' + (doc.edition_date || '') + ') status in smartPOA source registry: ' + (ctx.docStatus || 'unknown') + (ctx.lastCheck ? '; last FAA file check ' + ctx.lastCheck : '') + '.');
    const el = content.eligibility || {};
    const elItems = ['identity', 'iacra', 'knowledge', 'endorsements', 'experience', 'medical'];
    const elDone = elItems.filter((k) => el[k]).length;
    push('cfr_61_39', null, '14 CFR 61.39', 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/section-61.39', elDone === elItems.length ? 'attested' : 'review', elDone + ' of ' + elItems.length + ' eligibility items confirmed by the examiner.');
    push('cfr_61_45', null, '14 CFR 61.45', 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/section-61.45', el.aircraft ? 'attested' : 'review', el.aircraft ? 'Examiner confirmed the aircraft and equipment are suitable for the tasks.' : 'Aircraft suitability not yet confirmed.');
    if (profile.purpose === 'type_rating' || (profile.cert === 'atp' && profile.typeDesignator)) {
      push('fig588', 'n8900_610', 'FAA Notice N 8900.610', 'https://www.faa.gov/documentLibrary/media/Notice/N_8900.610.pdf', el.fig588 ? 'attested' : 'review', el.fig588 ? 'Examiner confirmed the type certificate holder is eligible (Figure 5-88).' : 'Confirm the aircraft TC holder is listed in Figure 5-88.');
      push('crew', null, '14 CFR 61.43(b)', 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/section-61.43', el.crew ? 'attested' : 'review', el.crew ? 'Crew complement for the test: ' + el.crew + '.' : 'Record whether the test is single-pilot or with a copilot (SIC required limitation).');
    }
    const counts = rows.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
    return { rows, counts, coverage: cov, ready: !rows.some((r) => r.status === 'gap') };
  }

  // Briefing scripts carried over from the JPJ examiner plan of action (legacy system). Examiners edit per plan.
  const DEFAULT_BRIEFINGS = {
    pretest: [
      'WELCOME',
      '- Make introductions and put the applicant at ease; discuss aviation goals and career plans',
      '- Privacy, exits, restrooms, water; breaks are available any time',
      '- Phones off; no recording',
      'QUALIFY THE APPLICANT',
      '- Confirm the test: {std}; training under Part 61 or Part 141',
      '- Status: Initial [ ]  Retest [ ]  Continuation [ ]',
      '- IACRA (or FAA Form 8710-1) signed by applicant and recommending instructor',
      '- Name or nationality change? [ ] Yes [ ] No    Drug conviction (Box O)? [ ] Yes [ ] No (if yes, coordinate with the FSDO before testing)',
      '- Foreign license verification? [ ] Yes [ ] N/A',
      '- Photo ID type __________ expiration __________; U.S. pilot certificate; medical; knowledge test report',
      '- Aeronautical experience and endorsements (see the eligibility checklist)',
      '- English proficiency adequate per AC 60-28? [ ] Yes [ ] No (refer to FSDO)',
      'QUALIFY THE AIRPLANE',
      '- Maintenance records: inspections (AVIATE) [ ]  ADs [ ]',
      '- Documents: AROW [ ] Airworthiness [ ] Registration [ ] POH/AFM [ ] Weight and balance [ ]',
      'TEST BRIEF',
      '- Conducted per the current ACS and FAA Order 8900.2 / 8000.95; I will use this plan of action and take notes for the debrief',
      '- The standard is the ACS, not perfection; oral questioning continues throughout; approved resources may be used',
      '- Outcomes: Temporary Airman Certificate (120 days), Letter of Discontinuance (60-day credit), Notice of Disapproval (60-day credit for tasks passed)',
      '- Unsatisfactory performance includes: corrective action by the examiner needed for safety of flight; ineffective visual scanning; failure to take prompt corrective action; consistently exceeding tolerances; outcome of a task in doubt or poor judgment; failure to exercise risk management; not meeting the standard',
      '- Examiner fee __________   Retest policy/fee __________   Continuation policy/fee __________   Fee collected [ ]',
      '- Privacy statement and Pilot\u2019s Bill of Rights notification given [ ]',
      '- Questions? Applicant signs IACRA 8710.   "The test has begun" time: __________',
    ].join('\n'),
    preflight: [
      'Time started: __________',
      'PIC BRIEF',
      '- The applicant remains pilot in command (14 CFR 61.47) and exercises PIC authority throughout',
      '- PIC responsibilities: preflight with checklist and documents; weight and balance and performance; first-flight-of-day preflight; fuel with reserves; 91.213 and 91.205 compliance; aircraft systems and equipment knowledge; passenger briefing',
      '- Unique aircraft traits? __________',
      '- Collision avoidance: clearing turns and scanning; checklist use for each phase',
      '- The examiner acts as a non-flying passenger. Positive exchange of flight controls: "You have the flight controls" / "I have the flight controls" / "You have the flight controls"',
      'EVALUATOR EXPECTATIONS',
      '- Safety first: immediate correction of any unsafe condition',
      '- Clear communication: verbalize actions and talk through procedures; checklist use is mandatory',
      'FLIGHT PORTION BRIEF',
      '- The test continues under the ACS and the plan of action, now flight focused; review the flight profile - no tricks',
      '- Simulated emergencies will be announced: "SIMULATED ________"',
      '- Actual emergency: you are PIC, use all resources; the test stops during an actual emergency',
      '- Other potential issues: weather, mechanical, medical',
      '- Every task must be completed and meet the standard: objective met, procedure completed, standards met, safety considered',
      '- If a task is unsatisfactory the applicant may continue or discontinue',
      '- Questions? __________   Time ended: __________',
    ].join('\n'),
    postflight: [
      'Time started: __________',
      'DEBRIEF (PRIVATE)',
      '- Outcome: [ ] Satisfactory  [ ] Discontinuance  [ ] Disapproval. Use the plan of action notes and ACS codes for the performance review',
      'SATISFACTORY',
      '- Temporary certificate (120 days): complete IACRA, print and sign the temporary certificate; advise to check with the FAA if the permanent certificate is delayed; sign the logbook; hole-punch the old certificate',
      'DISCONTINUANCE',
      '- Issue the Letter of Discontinuance (60 days). Remaining items: __________. Advise on continuation. Sign the logbook',
      'DISAPPROVAL',
      '- Explain the deficiencies with ACS codes: __________; highlight strengths: __________',
      '- Issue the Notice of Disapproval (60 days); credit for satisfactory tasks: __________; explain retest requirements (61.49); sign the logbook (optional)',
      'FINAL ITEMS',
      '- Review with the recommending instructor: [ ] Yes [ ] No',
      '- Time ended: __________',
    ].join('\n'),
  };

  root.SPE = { CLASS_LABEL, CERT_LABEL, PURPOSE_LABEL, HELD_OPTIONS, resolveStandard, requiredTasks, selectElements, elementCodes, taskKey,
    missionsFor, scenarioProfile, cfiMatrix, TRIGGERS, triggersFor, triggerCovers, scenarioCoverage, questionFor, complianceChecks, DEFAULT_BRIEFINGS, categoryOfClass, similarity };
})(typeof window !== 'undefined' ? window : globalThis);
