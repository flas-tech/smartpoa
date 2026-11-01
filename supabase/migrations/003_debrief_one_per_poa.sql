-- One debrief per plan of action (a retest gets its own plan).
create unique index if not exists debriefs_one_per_poa on public.debriefs(poa_id);
