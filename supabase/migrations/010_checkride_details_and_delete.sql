-- 0.2.8: checkride-specific details live on the checkride, and admins can delete records made in error.

alter table public.checkrides
  add column if not exists iacra_app_id text,
  add column if not exists recommending_instructor text,
  add column if not exists instructor_cert_number text,
  add column if not exists school text,
  add column if not exists knowledge_test jsonb not null default '{}'::jsonb;

-- Carry the details that used to sit on the applicant onto that applicant's checkrides.
update public.checkrides c set
  recommending_instructor = coalesce(c.recommending_instructor, a.recommending_instructor),
  instructor_cert_number = coalesce(c.instructor_cert_number, a.instructor_cert_number),
  school = coalesce(c.school, a.school)
from public.applicants a where a.id = c.applicant_id;

-- IACRA application ID only belongs to an open (not yet graded) checkride.
update public.checkrides c set iacra_app_id = a.iacra_app_id
from public.applicants a
where a.id = c.applicant_id and c.iacra_app_id is null and c.result is null and a.iacra_app_id is not null;

-- Knowledge tests: copy only the tests that belong to the checkride's certificate level.
with map(grade, code) as (values
  ('private','PAR'),('private','PAT'),('private','PRH'),('private','PHT'),('private','PCP'),('private','PFB'),
  ('commercial','CAX'),('commercial','CRH'),('commercial','CCP'),('commercial','MCN'),
  ('instrument','IRA'),('instrument','IRH'),('instrument','IFP'),('instrument','IFB'),('instrument','ICP'),
  ('atp','ATM'),('atp','ATS'),('atp','ATH'),('atp','ARH'),
  ('cfi','FOI'),('cfi','FIA'),('cfi','AFA'),('cfi','FRH'),('cfi','HFA'),('cfi','MCI'),
  ('cfii','FII'),('cfii','AIF'),('cfii','FIH'),('cfii','HIF'),('cfii','FOI')),
src as (
  select a.id, t from public.applicants a,
    jsonb_array_elements(case when jsonb_typeof(a.knowledge_test->'tests') = 'array' then a.knowledge_test->'tests'
      when coalesce(a.knowledge_test->>'test','') <> '' then jsonb_build_array(a.knowledge_test) else '[]'::jsonb end) t),
pick as (
  select c.id, jsonb_agg(s.t) tests
  from public.checkrides c join src s on s.id = c.applicant_id
  join map m on m.grade = c.grade_sought and m.code = upper(split_part(trim(s.t->>'test'), ' ', 1))
  where c.knowledge_test = '{}'::jsonb
  group by c.id)
update public.checkrides c set knowledge_test = jsonb_build_object('tests', p.tests,
  'aktr', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(p.tests) t, jsonb_array_elements_text(coalesce(t->'aktr','[]'::jsonb)) x))
from pick p where p.id = c.id;

-- Delete a checkride (and optionally its plan of action and result). Org admins only; the audit log records each row.
create or replace function public.delete_checkride(p_id uuid, p_with_plan boolean default false)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_org uuid; v_poa uuid; n_poa int := 0;
begin
  select org_id, poa_id into v_org, v_poa from public.checkrides where id = p_id;
  if v_org is null then raise exception 'Checkride not found'; end if;
  if not public.has_role(v_org, array['org_admin']) then raise exception 'Only an organization administrator can delete records'; end if;
  delete from public.data_flags where org_id = v_org and entity_id::text = p_id::text;
  delete from public.checkrides where id = p_id;
  if p_with_plan and v_poa is not null then
    update public.documents set poa_id = null where poa_id = v_poa;
    delete from public.poas where id = v_poa and org_id = v_org; get diagnostics n_poa = row_count;
  end if;
  return jsonb_build_object('checkride', 1, 'plans', n_poa);
end $$;

-- Delete an applicant with every checkride, plan, result and document row. Files are removed by the app first.
create or replace function public.delete_applicant(p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_org uuid; n_cr int; n_poa int; n_doc int;
begin
  select org_id into v_org from public.applicants where id = p_id;
  if v_org is null then raise exception 'Applicant not found'; end if;
  if not public.has_role(v_org, array['org_admin']) then raise exception 'Only an organization administrator can delete records'; end if;
  delete from public.data_flags where org_id = v_org and (entity_id::text = p_id::text or entity_id::text in (select id::text from public.checkrides where applicant_id = p_id));
  delete from public.documents where applicant_id = p_id or poa_id in (select id from public.poas where applicant_id = p_id); get diagnostics n_doc = row_count;
  delete from public.checkrides where applicant_id = p_id; get diagnostics n_cr = row_count;
  delete from public.debriefs where applicant_id = p_id;
  delete from public.poas where applicant_id = p_id; get diagnostics n_poa = row_count;
  delete from public.applicants where id = p_id;
  return jsonb_build_object('checkrides', n_cr, 'plans', n_poa, 'documents', n_doc);
end $$;

revoke all on function public.delete_checkride(uuid, boolean) from public, anon;
revoke all on function public.delete_applicant(uuid) from public, anon;
grant execute on function public.delete_checkride(uuid, boolean) to authenticated;
grant execute on function public.delete_applicant(uuid) to authenticated;
