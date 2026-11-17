-- smartPOA 007: track where a question bank entry came from (manual, AI draft import) for review.
alter table public.questions add column if not exists source text not null default 'manual' check (source in ('manual','ai_draft','import'));
alter table public.questions add column if not exists approved_at timestamptz;
create index if not exists questions_org_status on public.questions(org_id, status);
create index if not exists questions_org_code on public.questions(org_id, element_code);
