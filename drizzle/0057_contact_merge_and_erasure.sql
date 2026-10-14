-- Merging two records of the same person, and erasing a person on request (docs/leads.md §3.4, §6.5).
--
-- Both reach rows in other features' tables (support tickets, reviews) and rows people cannot
-- write themselves (website submissions, audit entries), so they run as security definer. Each
-- checks, before doing anything, that the caller holds the permission in their active business
-- and that every record named belongs to that business. The service calls them after its own
-- scope checks, inside the same transaction.

create function app.merge_contact_references(p_keep uuid, p_drop uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  t uuid := app.active_tenant_id();
begin
  if t is null or t not in (select app.tenant_ids())
     or not app.has_permission(t, 'contacts.merge') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_keep = p_drop or (
    select count(*) from public.contacts
    where tenant_id = t and id in (p_keep, p_drop) and deleted_at is null
  ) <> 2 then
    raise exception 'records not found' using errcode = 'P0002';
  end if;

  -- Links that would repeat one the kept record already has are dropped, then the rest move.
  delete from public.contact_organizations d
  using public.contact_organizations k
  where d.tenant_id = t and d.contact_id = p_drop
    and k.tenant_id = t and k.contact_id = p_keep
    and k.organization_id = d.organization_id and k.relationship = d.relationship;
  update public.contact_organizations set contact_id = p_keep
  where tenant_id = t and contact_id = p_drop;

  delete from public.contact_links
  where tenant_id = t
    and ((contact_id = p_drop and related_contact_id = p_keep)
      or (contact_id = p_keep and related_contact_id = p_drop));
  delete from public.contact_links d
  using public.contact_links k
  where d.tenant_id = t and d.contact_id = p_drop
    and k.tenant_id = t and k.contact_id = p_keep and k.related_contact_id = d.related_contact_id;
  update public.contact_links set contact_id = p_keep where tenant_id = t and contact_id = p_drop;
  delete from public.contact_links d
  using public.contact_links k
  where d.tenant_id = t and d.related_contact_id = p_drop
    and k.tenant_id = t and k.related_contact_id = p_keep and k.contact_id = d.contact_id;
  update public.contact_links set related_contact_id = p_keep
  where tenant_id = t and related_contact_id = p_drop;

  delete from public.opportunity_contacts d
  using public.opportunity_contacts k
  where d.tenant_id = t and d.contact_id = p_drop
    and k.tenant_id = t and k.contact_id = p_keep and k.opportunity_id = d.opportunity_id;
  -- The kept record may already be an opportunity's main contact; listing it again adds nothing.
  delete from public.opportunity_contacts d
  using public.opportunities o
  where d.tenant_id = t and d.contact_id = p_drop
    and o.tenant_id = t and o.id = d.opportunity_id and o.contact_id = p_keep;
  update public.opportunity_contacts set contact_id = p_keep
  where tenant_id = t and contact_id = p_drop;

  -- A sequence running on both records keeps the kept record's run; the other stops.
  update public.tasks set status = 'cancelled'
  where tenant_id = t and status = 'open' and sequence_enrollment_id in (
    select d.id from public.sequence_enrollments d
    join public.sequence_enrollments k
      on k.tenant_id = t and k.contact_id = p_keep and k.sequence_id = d.sequence_id
     and k.status = 'active'
    where d.tenant_id = t and d.contact_id = p_drop and d.status = 'active'
  );
  update public.sequence_enrollments d set status = 'stopped', ended_at = now()
  from public.sequence_enrollments k
  where d.tenant_id = t and d.contact_id = p_drop and d.status = 'active'
    and k.tenant_id = t and k.contact_id = p_keep and k.sequence_id = d.sequence_id
    and k.status = 'active';
  update public.sequence_enrollments set contact_id = p_keep
  where tenant_id = t and contact_id = p_drop;

  update public.activities set contact_id = p_keep where tenant_id = t and contact_id = p_drop;
  update public.tasks set contact_id = p_keep where tenant_id = t and contact_id = p_drop;
  update public.opportunities set contact_id = p_keep where tenant_id = t and contact_id = p_drop;
  update public.lead_intake_events set contact_id = p_keep
  where tenant_id = t and contact_id = p_drop;
  update public.tickets set contact_id = p_keep where tenant_id = t and contact_id = p_drop;
  update public.customer_reviews set contact_id = p_keep
  where tenant_id = t and contact_id = p_drop;
  update public.partners set primary_contact_id = p_keep
  where tenant_id = t and primary_contact_id = p_drop;
end;
$$;
revoke all on function app.merge_contact_references(uuid, uuid) from public;
grant execute on function app.merge_contact_references(uuid, uuid) to authenticated;

--> statement-breakpoint

-- The parts of an erasure the person's own grants cannot reach. The contact row, activities and
-- tasks are cleared by the service under RLS; this clears website submissions, support-ticket
-- and review contact details, and the values (not the fact) of past changes in the audit log.
create function app.erase_contact_traces(p_contact uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  t uuid := app.active_tenant_id();
begin
  if t is null or t not in (select app.tenant_ids())
     or not app.has_permission(t, 'contacts.anonymize') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contacts where tenant_id = t and id = p_contact) then
    raise exception 'record not found' using errcode = 'P0002';
  end if;

  update public.lead_intake_events set payload = '{"erased": true}'::jsonb
  where tenant_id = t and contact_id = p_contact;
  update public.tickets set requester_name = 'Erased', requester_email = null
  where tenant_id = t and contact_id = p_contact;
  update public.customer_reviews set customer_name = null, customer_email = null
  where tenant_id = t and contact_id = p_contact;
  update public.audit_logs
  set changes = (
    select coalesce(jsonb_object_agg(key, '["•••", "•••"]'::jsonb), '{}'::jsonb)
    from jsonb_object_keys(changes) as key
  )
  where tenant_id = t and entity_type = 'contact' and entity_id = p_contact
    and changes is not null and jsonb_typeof(changes) = 'object';
end;
$$;
revoke all on function app.erase_contact_traces(uuid) from public;
grant execute on function app.erase_contact_traces(uuid) to authenticated;
