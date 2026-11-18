-- Audit log viewer (milestone 14, ADR-063).

-- The audit log records what changed and from what to what (a contact's details before and after
-- an edit, the pay behind a contract), who did it, and from which address. Until now any active
-- member could read all of it inside their business; only the fact that no screen asked kept it
-- private. Reading it now needs audit.view in the active business, like every other sensitive
-- read. Writing is unchanged: `audit_append` (0006) still lets a member append their own entries.
drop policy tenant_isolation on "audit_logs";
create policy audit_read on "audit_logs" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id())
    and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'audit.view'))
  );

--> statement-breakpoint

-- A contact's or opportunity's timeline says "Changed phone, email" to anyone who can open the
-- record. It needs who, when and which fields, never the values, so it gets exactly that here
-- instead of the rows. The caller has already checked the record is in their scope
-- (docs/permissions.md: child records follow the parent); this checks they belong to the business
-- and hold the record's view permission.
create or replace function app.record_field_changes(
  p_entity_type text,
  p_entity_id uuid,
  p_limit integer default 50
)
returns table (id bigint, created_at timestamptz, actor_user_id uuid, fields text[])
language sql stable security definer set search_path = '' as $$
  select a.id, a.created_at, a.actor_user_id,
         array(select k.key from jsonb_object_keys(a.changes) with ordinality as k(key, n)
               order by k.n)
  from public.audit_logs a
  where a.tenant_id = (select app.active_tenant_id())
    and a.tenant_id in (select app.tenant_ids())
    and p_entity_type in ('contact', 'opportunity')
    and (select app.has_permission((select app.active_tenant_id()),
           case p_entity_type when 'contact' then 'contacts.view' else 'opportunities.view' end))
    and a.action = 'update'
    and a.entity_type = p_entity_type
    and a.entity_id = p_entity_id
    and jsonb_typeof(a.changes) = 'object'
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke execute on function app.record_field_changes(text, uuid, integer) from public;
grant execute on function app.record_field_changes(text, uuid, integer) to authenticated;

--> statement-breakpoint

-- Erasing a person on request also erases every record that was merged into them, found by
-- following the merge entries in the audit log. Whoever may erase must find all of them, with or
-- without audit.view, or a merged copy of the person's details would silently survive. The walk
-- happens here and returns record ids only.
create or replace function app.contacts_merged_into(p_contact uuid)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive folded(id) as (
    select a.entity_id
    from public.audit_logs a
    where a.tenant_id = (select app.active_tenant_id())
      and (select app.active_tenant_id()) in (select app.tenant_ids())
      and (select app.has_permission((select app.active_tenant_id()), 'contacts.anonymize'))
      and a.entity_type = 'contact'
      and a.context ->> 'mergedInto' = p_contact::text
    union
    select a.entity_id
    from public.audit_logs a
    join folded f on a.context ->> 'mergedInto' = f.id::text
    where a.tenant_id = (select app.active_tenant_id())
      and a.entity_type = 'contact'
  )
  select folded.id from folded where folded.id is not null;
$$;

revoke execute on function app.contacts_merged_into(uuid) from public;
grant execute on function app.contacts_merged_into(uuid) to authenticated;

--> statement-breakpoint

-- The viewer names whoever did each thing, including people who have since left. A former
-- member is no longer an active colleague, so the `users` policy hides their profile, yet an
-- audit trail is read most often about someone who has gone. This returns names only, only of
-- people who are or were members of the active business, and only to someone with audit.view.
create or replace function app.audit_actor_names(p_user_ids uuid[])
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.full_name
  from public.users u
  where u.id = any(p_user_ids)
    and (select app.active_tenant_id()) in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'audit.view'))
    and exists (
      select 1 from public.tenant_memberships m
      where m.tenant_id = (select app.active_tenant_id()) and m.user_id = u.id
    );
$$;

revoke execute on function app.audit_actor_names(uuid[]) from public;
grant execute on function app.audit_actor_names(uuid[]) to authenticated;
