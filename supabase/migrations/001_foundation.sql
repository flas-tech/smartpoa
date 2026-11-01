-- smartPOA foundation schema. Every data table is org-scoped, protected by RLS and requires MFA (aal2).
create extension if not exists pgcrypto with schema extensions;

-- ---------- helpers ----------
create or replace function public.mfa_ok() returns boolean language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
$$;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.platform_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','support')),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  kind text not null default 'dpe_practice' check (kind in ('dpe_practice','flight_school','flight_department')),
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  roles text[] not null default '{}' check (roles <@ array['org_admin','examiner','office','auditor']::text[]),
  status text not null default 'active' check (status in ('active','suspended')),
  display_name text,
  examiner_info jsonb not null default '{}'::jsonb, -- designee number, authorizations, managing office
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on public.org_members(user_id);

create or replace function public.is_platform_owner() returns boolean language sql stable security definer set search_path = '' as $$
  select public.mfa_ok() and exists (select 1 from public.platform_roles where user_id = auth.uid() and role = 'owner')
$$;

create or replace function public.has_role(p_org uuid, p_roles text[]) returns boolean language sql stable security definer set search_path = '' as $$
  select public.mfa_ok() and exists (
    select 1 from public.org_members m join public.orgs o on o.id = m.org_id
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active' and o.status = 'active' and m.roles && p_roles)
$$;

create or replace function public.is_member(p_org uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role(p_org, array['org_admin','examiner','office','auditor'])
$$;

-- ---------- invitations ----------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  kind text not null check (kind in ('org','platform')),
  email text not null,
  org_id uuid references public.orgs(id) on delete cascade,
  roles text[] not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id),
  revoked_at timestamptz
);

-- ---------- standards source registry ----------
create table public.standards_docs (
  id text primary key,                 -- e.g. acs6c
  doc_number text not null,            -- FAA-S-ACS-6C
  title text not null,
  kind text not null check (kind in ('ACS','PTS','CFR','ORDER','AC','NOTICE')),
  certificate text,
  category text,
  edition_date text,
  effective_date date,
  source_url text not null,
  sha256 text,
  retrieved_at timestamptz,
  status text not null default 'current' check (status in ('current','superseded','pending_review')),
  notes text
);

create table public.source_checks (
  id bigserial primary key,
  checked_at timestamptz not null default now(),
  checked_by uuid references auth.users(id),
  doc_id text references public.standards_docs(id),
  url text not null,
  http_status int,
  sha256 text,
  changed boolean,
  detail jsonb not null default '{}'::jsonb
);

-- ---------- people and aircraft ----------
create table public.applicants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  ftn text,                          -- FAA Tracking Number (IACRA)
  iacra_app_id text,
  cert_held text,                    -- e.g. Private ASEL, Instrument Airplane
  cert_number_last4 text check (cert_number_last4 is null or cert_number_last4 ~ '^[0-9A-Za-z]{1,4}$'),
  medical_class text,
  medical_date date,
  knowledge_test jsonb not null default '{}'::jsonb, -- {test, date, score, expires, aktr_codes[]}
  recommending_instructor text,
  instructor_cert_last4 text,
  school text,
  notes text,
  archived boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.applicants(org_id);

create table public.aircraft (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tail text not null,
  make_model text not null,
  category text not null default 'airplane',
  class text,                          -- ASEL, AMEL, ASES, AMES, helicopter, gyroplane
  type_designator text,                -- for type ratings
  tc_holder text,
  equipment jsonb not null default '{}'::jsonb,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.aircraft(org_id);

-- ---------- plans of action ----------
create table public.poas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  applicant_id uuid references public.applicants(id) on delete set null,
  aircraft_id uuid references public.aircraft(id) on delete set null,
  examiner_id uuid references auth.users(id),
  purpose text not null check (purpose in ('practical_test','mock_checkride','retest','added_rating','type_rating','training')),
  test_profile jsonb not null,         -- {cert, category, class, rating_type, held, ...}
  standard_id text references public.standards_docs(id),
  standard_sha256 text,
  test_date date,
  location text,
  title text,
  content jsonb not null default '{}'::jsonb,  -- tasks, scenario, briefings, questions
  compliance jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','final','completed','void')),
  version int not null default 1,
  content_hash text,
  finalized_at timestamptz,
  finalized_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.poas(org_id);
create index on public.poas(applicant_id);

create table public.poa_versions (
  poa_id uuid not null references public.poas(id) on delete cascade,
  version int not null,
  org_id uuid not null references public.orgs(id) on delete cascade,
  snapshot jsonb not null,
  content_hash text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (poa_id, version)
);

-- ---------- question bank ----------
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  standard_id text references public.standards_docs(id),
  element_code text,
  task_ref text,                       -- e.g. PA.I.C
  portion text not null default 'oral' check (portion in ('oral','flight','scenario')),
  prompt text not null,
  expected text,
  refs text,
  difficulty int not null default 2 check (difficulty between 1 and 3),
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  approved_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on public.questions(org_id, standard_id);

-- ---------- debriefs / outcomes ----------
create table public.debriefs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  poa_id uuid not null references public.poas(id) on delete cascade,
  applicant_id uuid references public.applicants(id) on delete set null,
  examiner_id uuid references auth.users(id),
  entry_mode text not null default 'tablet' check (entry_mode in ('tablet','paper')),
  results jsonb not null default '{}'::jsonb,   -- {taskKey: {grade:'S'|'U'|'NT', note, codes[]}}
  outcome text check (outcome in ('pass','fail','discontinued','incomplete')),
  unsat_codes text[] not null default '{}',
  oral_minutes int,
  flight_hours numeric(4,1),
  ground_start timestamptz,
  flight_start timestamptz,
  remarks text,
  status text not null default 'open' check (status in ('open','signed')),
  signed_at timestamptz,
  signed_hash text,
  test_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.debriefs(org_id);
create index on public.debriefs(poa_id);

-- ---------- document vault ----------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  applicant_id uuid references public.applicants(id) on delete set null,
  poa_id uuid references public.poas(id) on delete set null,
  kind text not null default 'other',
  filename text not null,
  storage_path text not null unique,
  size_bytes bigint,
  sha256 text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);
create index on public.documents(org_id);

-- ---------- audit chain ----------
create table public.audit_log (
  id bigserial primary key,
  org_id uuid,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now(),
  prev_hash text,
  hash text not null
);
create index on public.audit_log(org_id, id);

create or replace function public.audit_write(p_org uuid, p_action text, p_entity text, p_id text, p_detail jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_prev text; v_hash text; v_at timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext('smartpoa_audit'));
  select hash into v_prev from public.audit_log order by id desc limit 1;
  v_hash := encode(extensions.digest(coalesce(v_prev,'') || '|' || coalesce(p_org::text,'') || '|' || coalesce(auth.uid()::text,'') || '|' ||
            p_action || '|' || p_entity || '|' || coalesce(p_id,'') || '|' || coalesce(p_detail::text,'') || '|' || v_at::text, 'sha256'), 'hex');
  insert into public.audit_log(org_id, actor, action, entity, entity_id, detail, at, prev_hash, hash)
  values (p_org, auth.uid(), p_action, p_entity, p_id, coalesce(p_detail,'{}'::jsonb), v_at, v_prev, v_hash);
end $$;
revoke all on function public.audit_write(uuid,text,text,text,jsonb) from public, anon, authenticated;

create or replace function public.audit_trigger() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb; v_org uuid; v_id text; v_detail jsonb;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_org := nullif(v_row ->> 'org_id','')::uuid;
  v_id := coalesce(v_row ->> 'id', v_row ->> 'poa_id', v_row ->> 'user_id');
  v_detail := case tg_table_name
    when 'poas' then jsonb_build_object('status', v_row->>'status', 'version', v_row->>'version', 'hash', v_row->>'content_hash')
    when 'debriefs' then jsonb_build_object('status', v_row->>'status', 'outcome', v_row->>'outcome', 'hash', v_row->>'signed_hash')
    when 'documents' then jsonb_build_object('filename', v_row->>'filename', 'sha256', v_row->>'sha256')
    when 'org_members' then jsonb_build_object('user_id', v_row->>'user_id', 'roles', v_row->'roles', 'status', v_row->>'status')
    else '{}'::jsonb end;
  perform public.audit_write(v_org, lower(tg_op), tg_table_name, v_id, v_detail);
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['orgs','org_members','applicants','aircraft','poas','debriefs','documents','questions'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

create or replace function public.touch_updated() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch_applicants before update on public.applicants for each row execute function public.touch_updated();
create trigger touch_poas before update on public.poas for each row execute function public.touch_updated();
create trigger touch_debriefs before update on public.debriefs for each row execute function public.touch_updated();

-- Locked records: a finalized POA and a signed debrief cannot be edited in place.
create or replace function public.lock_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'poas' then
    if old.status in ('final','completed') and current_setting('smartpoa.allow_poa_change', true) is distinct from 'on' then
      if new.content is distinct from old.content or new.test_profile is distinct from old.test_profile or new.standard_id is distinct from old.standard_id
         or new.compliance is distinct from old.compliance or new.applicant_id is distinct from old.applicant_id then
        raise exception 'This plan of action is finalized. Create a revision to change it.';
      end if;
    end if;
  elsif tg_table_name = 'debriefs' then
    if old.status = 'signed' then raise exception 'This debrief is signed and locked.'; end if;
  end if;
  return new;
end $$;
create trigger lock_poas before update on public.poas for each row execute function public.lock_guard();
create trigger lock_debriefs before update on public.debriefs for each row execute function public.lock_guard();

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.platform_roles enable row level security;
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.invitations enable row level security;
alter table public.standards_docs enable row level security;
alter table public.source_checks enable row level security;
alter table public.applicants enable row level security;
alter table public.aircraft enable row level security;
alter table public.poas enable row level security;
alter table public.poa_versions enable row level security;
alter table public.questions enable row level security;
alter table public.debriefs enable row level security;
alter table public.documents enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_self on public.profiles for select to authenticated using (user_id = (select auth.uid()) or public.is_platform_owner()
  or exists (select 1 from public.org_members a join public.org_members b on a.org_id = b.org_id where a.user_id = (select auth.uid()) and b.user_id = profiles.user_id and public.is_member(a.org_id)));
create policy profiles_update on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy platform_roles_read on public.platform_roles for select to authenticated using (user_id = (select auth.uid()) or public.is_platform_owner());

create policy orgs_read on public.orgs for select to authenticated using (public.is_member(id) or public.is_platform_owner());
create policy orgs_update on public.orgs for update to authenticated using (public.has_role(id, array['org_admin']) or public.is_platform_owner())
  with check (public.has_role(id, array['org_admin']) or public.is_platform_owner());

create policy members_read on public.org_members for select to authenticated using (user_id = (select auth.uid()) or public.is_member(org_id) or public.is_platform_owner());

create policy std_read on public.standards_docs for select to authenticated using (public.mfa_ok());
create policy std_owner on public.standards_docs for all to authenticated using (public.is_platform_owner()) with check (public.is_platform_owner());
create policy checks_read on public.source_checks for select to authenticated using (public.mfa_ok());

-- applicants & aircraft: examiner/admin/office edit, auditor read
create policy applicants_read on public.applicants for select to authenticated using (public.is_member(org_id));
create policy applicants_ins on public.applicants for insert to authenticated with check (public.has_role(org_id, array['org_admin','examiner','office']));
create policy applicants_upd on public.applicants for update to authenticated using (public.has_role(org_id, array['org_admin','examiner','office'])) with check (public.has_role(org_id, array['org_admin','examiner','office']));
create policy applicants_del on public.applicants for delete to authenticated using (public.has_role(org_id, array['org_admin']));

create policy aircraft_read on public.aircraft for select to authenticated using (public.is_member(org_id));
create policy aircraft_ins on public.aircraft for insert to authenticated with check (public.has_role(org_id, array['org_admin','examiner','office']));
create policy aircraft_upd on public.aircraft for update to authenticated using (public.has_role(org_id, array['org_admin','examiner','office'])) with check (public.has_role(org_id, array['org_admin','examiner','office']));
create policy aircraft_del on public.aircraft for delete to authenticated using (public.has_role(org_id, array['org_admin']));

-- POAs: test-security content. Office staff cannot see them. Examiners edit their own; admins all.
create policy poas_read on public.poas for select to authenticated using (public.has_role(org_id, array['org_admin','examiner','auditor']));
create policy poas_ins on public.poas for insert to authenticated with check (public.has_role(org_id, array['org_admin','examiner']) and examiner_id = (select auth.uid()));
create policy poas_upd on public.poas for update to authenticated
  using (public.has_role(org_id, array['org_admin']) or (public.has_role(org_id, array['examiner']) and examiner_id = (select auth.uid())))
  with check (public.has_role(org_id, array['org_admin']) or (public.has_role(org_id, array['examiner']) and examiner_id = (select auth.uid())));
create policy poas_del on public.poas for delete to authenticated using (status = 'draft' and (public.has_role(org_id, array['org_admin']) or (public.has_role(org_id, array['examiner']) and examiner_id = (select auth.uid()))));
create policy poa_versions_read on public.poa_versions for select to authenticated using (public.has_role(org_id, array['org_admin','examiner','auditor']));

create policy questions_read on public.questions for select to authenticated using (public.has_role(org_id, array['org_admin','examiner','auditor']));
create policy questions_ins on public.questions for insert to authenticated with check (public.has_role(org_id, array['org_admin','examiner']));
create policy questions_upd on public.questions for update to authenticated using (public.has_role(org_id, array['org_admin','examiner'])) with check (public.has_role(org_id, array['org_admin','examiner']));
create policy questions_del on public.questions for delete to authenticated using (public.has_role(org_id, array['org_admin','examiner']) and status = 'draft');

create policy debriefs_read on public.debriefs for select to authenticated using (public.has_role(org_id, array['org_admin','examiner','auditor']));
create policy debriefs_ins on public.debriefs for insert to authenticated with check (public.has_role(org_id, array['org_admin','examiner']));
create policy debriefs_upd on public.debriefs for update to authenticated using (public.has_role(org_id, array['org_admin','examiner'])) with check (public.has_role(org_id, array['org_admin','examiner']));

create policy documents_read on public.documents for select to authenticated using (public.is_member(org_id));
create policy documents_ins on public.documents for insert to authenticated with check (public.has_role(org_id, array['org_admin','examiner','office']) and uploaded_by = (select auth.uid()));
create policy documents_del on public.documents for delete to authenticated using (public.has_role(org_id, array['org_admin']));

create policy audit_read on public.audit_log for select to authenticated using ((org_id is not null and public.has_role(org_id, array['org_admin','auditor'])) or public.is_platform_owner());

-- ---------- storage ----------
insert into storage.buckets (id, name, public, file_size_limit) values ('records', 'records', false, 52428800) on conflict (id) do nothing;
create policy records_read on storage.objects for select to authenticated using (bucket_id = 'records' and public.is_member((storage.foldername(name))[1]::uuid));
create policy records_write on storage.objects for insert to authenticated with check (bucket_id = 'records' and public.has_role((storage.foldername(name))[1]::uuid, array['org_admin','examiner','office']));
create policy records_delete on storage.objects for delete to authenticated using (bucket_id = 'records' and public.has_role((storage.foldername(name))[1]::uuid, array['org_admin']));

-- ---------- RPCs ----------
create or replace function public.my_context() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'user_id', auth.uid(),
    'aal', auth.jwt() ->> 'aal',
    'profile', (select to_jsonb(p) from public.profiles p where p.user_id = auth.uid()),
    'platform_roles', coalesce((select jsonb_agg(role) from public.platform_roles where user_id = auth.uid()), '[]'::jsonb),
    'orgs', case when public.mfa_ok() then coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'roles', m.roles, 'status', o.status) order by o.name)
              from public.org_members m join public.orgs o on o.id = m.org_id where m.user_id = auth.uid() and m.status = 'active'), '[]'::jsonb) else '[]'::jsonb end
  ) into v;
  return v;
end $$;

create or replace function public.create_org(p_name text, p_kind text, p_admin_self boolean default true) returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not public.is_platform_owner() then raise exception 'not authorized'; end if;
  insert into public.orgs(name, kind, created_by) values (trim(p_name), p_kind, auth.uid()) returning id into v;
  if p_admin_self then insert into public.org_members(org_id, user_id, roles) values (v, auth.uid(), array['org_admin','examiner']); end if;
  return v;
end $$;

create or replace function public.create_invitation(p_org uuid, p_email text, p_roles text[]) returns text language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if p_org is null then
    if not public.is_platform_owner() then raise exception 'not authorized'; end if;
    insert into public.invitations(token_hash, kind, email, roles, created_by, expires_at)
      values (encode(extensions.digest(v_token,'sha256'),'hex'), 'platform', lower(trim(p_email)), array['owner'], auth.uid(), now() + interval '72 hours');
  else
    if not (public.has_role(p_org, array['org_admin']) or public.is_platform_owner()) then raise exception 'not authorized'; end if;
    if p_roles is null or array_length(p_roles,1) is null or not (p_roles <@ array['org_admin','examiner','office','auditor']) then raise exception 'invalid roles'; end if;
    insert into public.invitations(token_hash, kind, email, org_id, roles, created_by, expires_at)
      values (encode(extensions.digest(v_token,'sha256'),'hex'), 'org', lower(trim(p_email)), p_org, p_roles, auth.uid(), now() + interval '7 days');
  end if;
  perform public.audit_write(p_org, 'invite', 'invitations', lower(trim(p_email)), jsonb_build_object('roles', p_roles));
  return v_token;
end $$;

-- service-role only: used by the redeem-invite edge function
create or replace function public.invite_lookup(p_token text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', i.email, 'kind', i.kind, 'roles', i.roles, 'org', o.name)
  from public.invitations i left join public.orgs o on o.id = i.org_id
  where i.token_hash = encode(extensions.digest(p_token,'sha256'),'hex') and i.used_at is null and i.revoked_at is null and i.expires_at > now()
$$;
revoke all on function public.invite_lookup(text) from public, anon, authenticated;

create or replace function public.accept_invitation(p_token text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.invitations; v_email text;
begin
  if not public.mfa_ok() then raise exception 'MFA required'; end if;
  select email into v_email from auth.users where id = auth.uid();
  select * into i from public.invitations where token_hash = encode(extensions.digest(p_token,'sha256'),'hex') and used_at is null and revoked_at is null and expires_at > now() for update;
  if i.id is null or lower(i.email) <> lower(v_email) then raise exception 'invitation invalid'; end if;
  insert into public.profiles(user_id, email) values (auth.uid(), lower(v_email)) on conflict (user_id) do nothing;
  if i.kind = 'platform' then
    insert into public.platform_roles(user_id, role) values (auth.uid(), 'owner') on conflict do nothing;
  else
    insert into public.org_members(org_id, user_id, roles) values (i.org_id, auth.uid(), i.roles)
      on conflict (org_id, user_id) do update set roles = (select array(select distinct unnest(public.org_members.roles || excluded.roles))), status = 'active';
  end if;
  update public.invitations set used_at = now(), used_by = auth.uid() where id = i.id;
  perform public.audit_write(i.org_id, 'accept_invite', 'invitations', i.id::text, jsonb_build_object('kind', i.kind));
  return jsonb_build_object('kind', i.kind, 'org_id', i.org_id);
end $$;

create or replace function public.set_member_roles(p_org uuid, p_user uuid, p_roles text[], p_status text default 'active') returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_role(p_org, array['org_admin']) or public.is_platform_owner()) then raise exception 'not authorized'; end if;
  if not (p_roles <@ array['org_admin','examiner','office','auditor']) then raise exception 'invalid roles'; end if;
  if array_length(p_roles,1) is null then raise exception 'A member must keep at least one role. Suspend them instead.'; end if;
  if p_user = auth.uid() and not ('org_admin' = any(p_roles)) and not public.is_platform_owner() then raise exception 'You cannot remove your own administrator role.'; end if;
  update public.org_members set roles = p_roles, status = p_status where org_id = p_org and user_id = p_user;
  if not exists (select 1 from public.org_members where org_id = p_org and status = 'active' and 'org_admin' = any(roles)) then
    raise exception 'The organization must keep at least one active administrator.';
  end if;
end $$;

create or replace function public.org_members_list(p_org uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.is_member(p_org) or public.is_platform_owner() then coalesce(jsonb_agg(jsonb_build_object(
    'user_id', m.user_id, 'email', p.email, 'full_name', coalesce(m.display_name, p.full_name), 'roles', m.roles, 'status', m.status, 'examiner_info', m.examiner_info, 'joined_at', m.joined_at) order by p.email), '[]'::jsonb) end
  from public.org_members m left join public.profiles p on p.user_id = m.user_id where m.org_id = p_org
$$;

create or replace function public.org_invitations_list(p_org uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.has_role(p_org, array['org_admin']) or public.is_platform_owner() then coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'email', email, 'roles', roles, 'created_at', created_at, 'expires_at', expires_at, 'used_at', used_at, 'revoked_at', revoked_at) order by created_at desc), '[]'::jsonb) end
  from public.invitations where org_id = p_org
$$;

create or replace function public.revoke_invitation(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.invitations where id = p_id;
  if not (public.has_role(v_org, array['org_admin']) or public.is_platform_owner()) then raise exception 'not authorized'; end if;
  update public.invitations set revoked_at = now() where id = p_id and used_at is null;
end $$;

create or replace function public.update_my_profile(p_full_name text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.mfa_ok() then raise exception 'MFA required'; end if;
  insert into public.profiles(user_id, email, full_name) select auth.uid(), lower(email), p_full_name from auth.users where id = auth.uid()
  on conflict (user_id) do update set full_name = excluded.full_name;
end $$;

create or replace function public.set_examiner_info(p_org uuid, p_info jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(p_org) then raise exception 'not authorized'; end if;
  update public.org_members set examiner_info = coalesce(p_info,'{}'::jsonb) where org_id = p_org and user_id = auth.uid();
end $$;

-- Finalize: snapshot + hash, lock.
create or replace function public.finalize_poa(p_id uuid) returns text language plpgsql security definer set search_path = '' as $$
declare p public.poas; v_hash text; v_snap jsonb;
begin
  select * into p from public.poas where id = p_id for update;
  if p.id is null or not (public.has_role(p.org_id, array['org_admin']) or (public.has_role(p.org_id, array['examiner']) and p.examiner_id = auth.uid())) then raise exception 'not authorized'; end if;
  if p.status <> 'draft' then raise exception 'Only a draft can be finalized.'; end if;
  v_snap := jsonb_build_object('purpose', p.purpose, 'test_profile', p.test_profile, 'standard_id', p.standard_id, 'standard_sha256', p.standard_sha256,
    'applicant_id', p.applicant_id, 'aircraft_id', p.aircraft_id, 'test_date', p.test_date, 'location', p.location, 'title', p.title,
    'content', p.content, 'compliance', p.compliance, 'version', p.version, 'examiner_id', p.examiner_id);
  v_hash := encode(extensions.digest(v_snap::text, 'sha256'), 'hex');
  insert into public.poa_versions(poa_id, version, org_id, snapshot, content_hash, created_by) values (p.id, p.version, p.org_id, v_snap, v_hash, auth.uid())
    on conflict (poa_id, version) do update set snapshot = excluded.snapshot, content_hash = excluded.content_hash, created_by = excluded.created_by, created_at = now();
  update public.poas set status = 'final', content_hash = v_hash, finalized_at = now(), finalized_by = auth.uid() where id = p.id;
  return v_hash;
end $$;

create or replace function public.revise_poa(p_id uuid) returns int language plpgsql security definer set search_path = '' as $$
declare p public.poas;
begin
  select * into p from public.poas where id = p_id for update;
  if p.id is null or not (public.has_role(p.org_id, array['org_admin']) or (public.has_role(p.org_id, array['examiner']) and p.examiner_id = auth.uid())) then raise exception 'not authorized'; end if;
  if p.status <> 'final' then raise exception 'Only a finalized plan can be revised.'; end if;
  perform set_config('smartpoa.allow_poa_change', 'on', true);
  update public.poas set status = 'draft', version = p.version + 1, content_hash = null, finalized_at = null, finalized_by = null where id = p.id;
  return p.version + 1;
end $$;

create or replace function public.sign_debrief(p_id uuid) returns text language plpgsql security definer set search_path = '' as $$
declare d public.debriefs; v_hash text;
begin
  select * into d from public.debriefs where id = p_id for update;
  if d.id is null or not public.has_role(d.org_id, array['org_admin','examiner']) then raise exception 'not authorized'; end if;
  if d.status = 'signed' then raise exception 'Already signed.'; end if;
  if d.outcome is null then raise exception 'Select an outcome before signing.'; end if;
  v_hash := encode(extensions.digest(jsonb_build_object('poa', d.poa_id, 'results', d.results, 'outcome', d.outcome, 'codes', d.unsat_codes, 'remarks', d.remarks, 'date', d.test_date, 'examiner', auth.uid())::text, 'sha256'), 'hex');
  update public.debriefs set status = 'signed', signed_at = now(), signed_hash = v_hash, examiner_id = coalesce(examiner_id, auth.uid()) where id = d.id;
  if d.outcome in ('pass','fail','discontinued') then
    perform set_config('smartpoa.allow_poa_change', 'on', true);
    update public.poas set status = 'completed' where id = d.poa_id and status = 'final';
  end if;
  return v_hash;
end $$;

create or replace function public.verify_audit_chain(p_limit int default 5000) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r record; v_prev text := null; v_bad int := 0; v_n int := 0; v_calc text;
begin
  if not public.is_platform_owner() then raise exception 'not authorized'; end if;
  for r in select * from public.audit_log order by id limit p_limit loop
    v_n := v_n + 1;
    v_calc := encode(extensions.digest(coalesce(v_prev,'') || '|' || coalesce(r.org_id::text,'') || '|' || coalesce(r.actor::text,'') || '|' || r.action || '|' || r.entity || '|' || coalesce(r.entity_id,'') || '|' || coalesce(r.detail::text,'') || '|' || r.at::text, 'sha256'), 'hex');
    if v_calc <> r.hash or coalesce(r.prev_hash,'') <> coalesce(v_prev,'') then v_bad := v_bad + 1; end if;
    v_prev := r.hash;
  end loop;
  return jsonb_build_object('checked', v_n, 'mismatches', v_bad);
end $$;

-- grants
revoke execute on all functions in schema public from anon;
grant execute on function public.my_context(), public.create_org(text,text,boolean), public.create_invitation(uuid,text,text[]), public.accept_invitation(text),
  public.set_member_roles(uuid,uuid,text[],text), public.org_members_list(uuid), public.org_invitations_list(uuid), public.revoke_invitation(uuid),
  public.update_my_profile(text), public.set_examiner_info(uuid,jsonb), public.finalize_poa(uuid), public.revise_poa(uuid), public.sign_debrief(uuid),
  public.verify_audit_chain(int), public.mfa_ok(), public.is_member(uuid), public.has_role(uuid,text[]), public.is_platform_owner() to authenticated;
