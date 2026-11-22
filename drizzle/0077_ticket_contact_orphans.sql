-- Tickets gain a composite foreign key to contacts in the next migration (ADR-069). Contacts are
-- never hard-deleted outside deleting a whole business, but clear any reference to a missing one
-- first so that key can be added on every database.
update public.tickets t set contact_id = null
where t.contact_id is not null
  and not exists (
    select 1 from public.contacts c where c.tenant_id = t.tenant_id and c.id = t.contact_id
  );
