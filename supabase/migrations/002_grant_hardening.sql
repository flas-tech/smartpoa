revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
revoke execute on function public.audit_trigger(), public.lock_guard(), public.touch_updated(), public.audit_write(uuid,text,text,text,jsonb), public.invite_lookup(text) from authenticated;
grant execute on function public.invite_lookup(text) to service_role;
grant execute on function public.my_context(), public.create_org(text,text,boolean), public.create_invitation(uuid,text,text[]), public.accept_invitation(text),
  public.set_member_roles(uuid,uuid,text[],text), public.org_members_list(uuid), public.org_invitations_list(uuid), public.revoke_invitation(uuid),
  public.update_my_profile(text), public.set_examiner_info(uuid,jsonb), public.finalize_poa(uuid), public.revise_poa(uuid), public.sign_debrief(uuid),
  public.verify_audit_chain(int), public.mfa_ok(), public.is_member(uuid), public.has_role(uuid,text[]), public.is_platform_owner() to authenticated;
create policy invitations_none on public.invitations for select to authenticated using (false);
