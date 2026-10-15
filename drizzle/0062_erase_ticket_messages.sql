-- Erasing a person now also clears what they wrote on support tickets (docs/leads.md §6.5):
-- the customer's own messages, and the first message when staff logged the request for them,
-- which carries the customer's name and words. Staff replies are kept.
CREATE OR REPLACE FUNCTION app.erase_contact_traces(p_contact uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  update public.ticket_messages m
  set author_name = 'Erased', body = 'Erased on request'
  from public.tickets tk
  where m.tenant_id = t and tk.tenant_id = t and m.ticket_id = tk.id
    and tk.contact_id = p_contact
    and (m.author_user_id is null or m.author_name like '% (logged by staff)');
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
$function$;
