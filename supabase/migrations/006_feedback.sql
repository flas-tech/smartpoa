-- smartPOA 006: in-app feedback. Any signed-in user can send feedback and see their own submissions;
-- the platform owner reviews, sets status and replies.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email text,
  org_id uuid references public.orgs(id) on delete set null,
  kind text not null default 'idea' check (kind in ('bug','idea','question','other')),
  message text not null check (char_length(btrim(message)) between 3 and 4000),
  page text check (page is null or char_length(page) <= 300),
  app_version text check (app_version is null or char_length(app_version) <= 20),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  status text not null default 'new' check (status in ('new','reviewing','planned','done','wont_fix')),
  reply text check (reply is null or char_length(reply) <= 4000),
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_status on public.feedback(status, created_at desc);
create index if not exists feedback_user on public.feedback(user_id, created_at desc);
alter table public.feedback enable row level security;

-- Server-set fields on insert: owner, email, status and reply cannot be chosen by the sender; simple rate limit.
create or replace function public.feedback_before_insert() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to send feedback'; end if;
  if (select count(*) from public.feedback where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Feedback limit reached. Please try again later.';
  end if;
  new.user_id := auth.uid();
  new.email := (select email from auth.users where id = auth.uid());
  if new.org_id is not null and not public.is_member(new.org_id) then new.org_id := null; end if;
  new.status := 'new'; new.reply := null; new.replied_at := null;
  new.message := btrim(new.message);
  new.created_at := now(); new.updated_at := now();
  return new;
end $$;
create trigger feedback_bi before insert on public.feedback for each row execute function public.feedback_before_insert();
create trigger touch_feedback before update on public.feedback for each row execute function public.touch_updated();

create policy feedback_ins on public.feedback for insert to authenticated with check (public.mfa_ok() and user_id = auth.uid());
create policy feedback_read on public.feedback for select to authenticated using ((public.mfa_ok() and user_id = auth.uid()) or public.is_platform_owner());
create policy feedback_upd on public.feedback for update to authenticated using (public.is_platform_owner()) with check (public.is_platform_owner());
create policy feedback_del on public.feedback for delete to authenticated using (public.is_platform_owner());
grant select, insert, update, delete on public.feedback to authenticated;
revoke all on public.feedback from anon;
