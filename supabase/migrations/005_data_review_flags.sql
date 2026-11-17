-- smartPOA 005: Data Review — flagged records for the organization to correct.
-- Flags are created by imports (and by examiners); live rule checks run in the browser and need no table.
create table if not exists public.data_flags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity text not null check (entity in ('applicant','checkride','aircraft','briefing','standards','settings','org')),
  entity_id uuid,
  field text,
  severity text not null default 'warning' check (severity in ('error','warning','question')),
  title text not null,
  detail text,
  suggested text,
  source text not null default 'manual' check (source in ('manual','airtable_import')),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution_note text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists data_flags_org_status on public.data_flags(org_id, status);
create index if not exists data_flags_entity on public.data_flags(entity_id);
alter table public.data_flags enable row level security;
create policy data_flags_read on public.data_flags for select to authenticated using (public.is_member(org_id));
create policy data_flags_ins on public.data_flags for insert to authenticated with check (public.has_role(org_id, array['org_admin','examiner','office']));
create policy data_flags_upd on public.data_flags for update to authenticated using (public.has_role(org_id, array['org_admin','examiner','office'])) with check (public.has_role(org_id, array['org_admin','examiner','office']));
create policy data_flags_del on public.data_flags for delete to authenticated using (public.has_role(org_id, array['org_admin']));
grant select, insert, update, delete on public.data_flags to authenticated;
revoke all on public.data_flags from anon;
create trigger touch_data_flags before update on public.data_flags for each row execute function public.touch_updated();
create trigger audit_data_flags after insert or update or delete on public.data_flags for each row execute function public.audit_trigger();
