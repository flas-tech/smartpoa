-- smartPOA 004: merge of the legacy JPJ checkride management system (Airtable) into smartPOA.
-- Adds checkride records (schedule + outcomes + ground/flight times), CFI ACS-25, continuation and
-- reinstatement purposes, instructor certificate numbers, and an AI usage log for the ai-generate function.

alter table public.applicants add column if not exists instructor_cert_number text;
alter table public.applicants add column if not exists legacy_id text;
create unique index if not exists applicants_legacy_uq on public.applicants(org_id, legacy_id) where legacy_id is not null;

alter table public.poas drop constraint if exists poas_purpose_check;
alter table public.poas add constraint poas_purpose_check check (purpose in
  ('practical_test','mock_checkride','retest','added_rating','type_rating','training','continuation','reinstatement'));

create table if not exists public.checkrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  applicant_id uuid references public.applicants(id) on delete set null,
  poa_id uuid references public.poas(id) on delete set null,
  examiner_id uuid references auth.users(id),
  preapproval_number text,
  scheduled_at timestamptz,
  departure_airport text,
  test_type text not null default 'Original Certificate' check (test_type in (
    'Original Certificate','Retest for Original Certificate','Additional Rating','Retest For Additional Rating',
    'Continued from Previously Discontinued Test','Instrument Rating','Retest for Instrument Rating','Reinstatement of CFI','Type Rating','Mock Checkride')),
  grade_sought text check (grade_sought in ('private','commercial','instrument','cfi','atp')),
  category text not null default 'Airplane',
  class text,
  basis text check (basis is null or basis in ('Completion of Test or Activity','U.S. Military Competence or Experience','Graduate of Approved Course','Holder of Foreign License','Air Carrier Training Program')),
  aircraft_make_model text,
  tail_number text,
  result text check (result is null or result in ('temporary','disapproval','discontinuance','cancelled')),
  ground_time numeric(4,1) check (ground_time is null or (ground_time >= 0 and ground_time < 24)),
  flight_time numeric(4,1) check (flight_time is null or (flight_time >= 0 and flight_time < 24)),
  notes text,
  source text not null default 'manual' check (source in ('manual','airtable_import')),
  legacy_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists checkrides_org_sched on public.checkrides(org_id, scheduled_at);
create unique index if not exists checkrides_legacy_uq on public.checkrides(org_id, legacy_id) where legacy_id is not null;

alter table public.checkrides enable row level security;
create policy checkrides_read on public.checkrides for select to authenticated using (public.is_member(org_id));
create policy checkrides_ins on public.checkrides for insert to authenticated with check (public.has_role(org_id, array['org_admin','examiner','office']));
create policy checkrides_upd on public.checkrides for update to authenticated using (public.has_role(org_id, array['org_admin','examiner','office'])) with check (public.has_role(org_id, array['org_admin','examiner','office']));
create policy checkrides_del on public.checkrides for delete to authenticated using (public.has_role(org_id, array['org_admin']));
grant select, insert, update, delete on public.checkrides to authenticated;
revoke all on public.checkrides from anon;

create trigger touch_checkrides before update on public.checkrides for each row execute function public.touch_updated();
create trigger audit_checkrides after insert or update or delete on public.checkrides for each row execute function public.audit_trigger();

-- AI usage log (written only by the ai-generate edge function with the service role)
create table if not exists public.ai_usage (
  id bigserial primary key,
  org_id uuid references public.orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null,
  model text,
  prompt_tokens int,
  completion_tokens int,
  ok boolean not null default true,
  at timestamptz not null default now()
);
create index if not exists ai_usage_user_at on public.ai_usage(user_id, at);
alter table public.ai_usage enable row level security;
create policy ai_usage_read on public.ai_usage for select to authenticated using ((org_id is not null and public.has_role(org_id, array['org_admin'])) or public.is_platform_owner());
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

insert into public.standards_docs(id, doc_number, title, kind, certificate, category, edition_date, source_url, sha256, status)
values ('acs25','FAA-S-ACS-25','Flight Instructor for Airplane Category ACS','ACS','cfi','airplane','November 2023',
        'https://www.faa.gov/training_testing/testing/acs/cfi_airplane_acs_25.pdf',
        '67f98971c8cb53b5e8a7869c9a3b43424070ab1c5b2594492f24f8b823d41caf', 'current')
on conflict (id) do nothing;
update public.standards_docs set retrieved_at = now() where id = 'acs25';

-- Service-only secret lookup for edge functions. The xAI key itself is stored in Supabase Vault
-- (vault.create_secret(<key>, 'grok_api_key')) and is never committed to this public repository.
create or replace function public.app_secret(p_name text) returns text language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1 $$;
revoke all on function public.app_secret(text) from public, anon, authenticated;
grant execute on function public.app_secret(text) to service_role;
