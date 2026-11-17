-- Debrief timing: ground and flight durations kept in minutes (shown as HH:MM), explicit stop times for the
-- live timers, and Hobbs meter readings at the start and end of the flight portion.
alter table public.debriefs
  add column if not exists flight_minutes int check (flight_minutes is null or flight_minutes between 0 and 1440),
  add column if not exists ground_end timestamptz,
  add column if not exists flight_end timestamptz,
  add column if not exists hobbs_start numeric(8,1) check (hobbs_start is null or hobbs_start >= 0),
  add column if not exists hobbs_end numeric(8,1) check (hobbs_end is null or hobbs_end >= 0);
alter table public.debriefs drop constraint if exists debriefs_hobbs_order;
alter table public.debriefs add constraint debriefs_hobbs_order check (hobbs_start is null or hobbs_end is null or hobbs_end >= hobbs_start);
update public.debriefs set flight_minutes = round(flight_hours * 60) where flight_minutes is null and flight_hours is not null;
