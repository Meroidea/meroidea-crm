-- Deleting an applicant is how a business answers someone asking for their details to be
-- removed, so it must remove them, not only hide the row. Notes about an applicant are otherwise
-- append-only (no delete grant), so this function deletes them only for an applicant that has
-- just been deleted, and blanks what the audit log recorded about them.
create function app.erase_applicant_traces(p_applicant uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  t uuid := app.active_tenant_id();
begin
  if t is null or t not in (select app.tenant_ids())
     or not app.has_permission(t, 'recruitment.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.job_applicants
    where tenant_id = t and id = p_applicant and deleted_at is not null
  ) then
    raise exception 'record not found' using errcode = 'P0002';
  end if;

  delete from public.applicant_notes where tenant_id = t and applicant_id = p_applicant;
  update public.audit_logs
  set changes = (
    select coalesce(jsonb_object_agg(key, '["•••", "•••"]'::jsonb), '{}'::jsonb)
    from jsonb_object_keys(changes) as key
  )
  where tenant_id = t and entity_type = 'job_applicant' and entity_id = p_applicant
    and changes is not null and jsonb_typeof(changes) = 'object';
end;
$$;
revoke all on function app.erase_applicant_traces(uuid) from public;
grant execute on function app.erase_applicant_traces(uuid) to authenticated;
