-- Signature requests from 0086 (ADR-094): tenant isolation, who may write what, a guard on status
-- changes, the feature switch, and the new permission for existing workspaces.
-- See docs/database.md §7f (Signature requests) and docs/permissions.md.
--
-- Signers have no login. Everything they do (codes, viewing, signing, declining) and the final
-- stamping run on the server's privileged connection in src/modules/esign/public.ts, starting
-- from their link's hash. Signed-in people therefore get no grants on the credential columns, and
-- none on the columns that say a request is complete: otherwise a staff member could mark a file
-- of their own making as the signed original through the REST API.

create trigger set_updated_at before update on "sign_requests"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "sign_request_signers"
  for each row execute function app.set_updated_at();

alter table "sign_request_signers" add constraint sign_request_signers_email_lower
  check (email = lower(email) and email like '%_@_%');
alter table "sign_request_signers" add constraint sign_request_signers_otp_attempts_check
  check (otp_attempts between 0 and 10);
alter table "sign_requests" add constraint sign_requests_title_length
  check (char_length(title) between 1 and 200);

--> statement-breakpoint

-- A session may only send a draft, void a request that is out, or remove a draft. Completion and
-- declining happen on the privileged connection only, and a finished request never reopens.
create or replace function app.sign_requests_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if old.status in ('completed', 'declined', 'voided') then
    raise exception 'This signature request is finished and can no longer change.'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'draft' and new.status = 'sent')
           or (old.status = 'sent' and new.status = 'voided')) then
    raise exception 'That change to a signature request is not allowed.' using errcode = '42501';
  end if;
  -- What was sent is what gets signed: the file, its hash and the signing rules are fixed.
  if old.status <> 'draft' and (
       new.original_sha256 is distinct from old.original_sha256
    or new.page_count is distinct from old.page_count
    or new.signing_order is distinct from old.signing_order
    or new.expiry_days is distinct from old.expiry_days
    or new.verify_email is distinct from old.verify_email
    or new.title is distinct from old.title
    or new.message is distinct from old.message
    or new.sent_at is distinct from old.sent_at
    or new.sent_by is distinct from old.sent_by
    or (new.deleted_at is not null and old.deleted_at is null)) then
    raise exception 'A sent signature request can only be voided.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger sign_requests_guard before update on "sign_requests"
  for each row execute function app.sign_requests_guard();

--> statement-breakpoint

alter table "sign_requests" enable row level security;
alter table "sign_request_signers" enable row level security;
alter table "sign_request_fields" enable row level security;
alter table "sign_request_events" enable row level security;

create policy sign_requests_read on "sign_requests" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
  );
create policy sign_requests_insert on "sign_requests" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
    and status = 'draft' and original_sha256 is null and signed_storage_path is null
    and signed_sha256 is null and completed_at is null and declined_at is null
    and sent_at is null and voided_at is null
  );
create policy sign_requests_update on "sign_requests" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
  );

-- Signers and fields of a request are read with it; they are added and removed only while it is
-- a draft.
create policy sign_request_signers_read on "sign_request_signers" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
  );
create policy sign_request_signers_insert on "sign_request_signers" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
    and status = 'pending' and token_hash is null and otp_hash is null and session_hash is null
    and otp_attempts = 0 and verified_at is null and viewed_at is null and signed_at is null
    and signed_ip is null and signed_user_agent is null and declined_at is null
    and decline_reason is null and invited_at is null
    and exists (select 1 from public.sign_requests r
                where r.tenant_id = sign_request_signers.tenant_id
                  and r.id = sign_request_signers.request_id and r.status = 'draft')
  );
-- Updating is only for issuing a fresh link to someone still to sign, on a request that is out.
create policy sign_request_signers_update on "sign_request_signers" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
    and status = 'pending'
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
    and status = 'pending'
  );
create policy sign_request_signers_delete on "sign_request_signers" for delete to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
    and exists (select 1 from public.sign_requests r
                where r.tenant_id = sign_request_signers.tenant_id
                  and r.id = sign_request_signers.request_id and r.status = 'draft')
  );

create policy sign_request_fields_read on "sign_request_fields" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
  );
create policy sign_request_fields_insert on "sign_request_fields" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
    and value is null and filled_at is null
    and exists (select 1 from public.sign_requests r
                where r.tenant_id = sign_request_fields.tenant_id
                  and r.id = sign_request_fields.request_id and r.status = 'draft')
  );
create policy sign_request_fields_delete on "sign_request_fields" for delete to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
    and exists (select 1 from public.sign_requests r
                where r.tenant_id = sign_request_fields.tenant_id
                  and r.id = sign_request_fields.request_id and r.status = 'draft')
  );

create policy sign_request_events_read on "sign_request_events" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
  );
-- Staff record only their own events, never a signer's.
create policy sign_request_events_insert on "sign_request_events" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.request_signatures'))
    and actor_user_id = (select auth.uid())
    and event in ('created', 'sent', 'invited', 'voided')
    and ip is null and user_agent is null
  );

--> statement-breakpoint

grant select, insert on "sign_requests" to authenticated;
grant update (title, message, signing_order, verify_email, expiry_days, expires_at, status, page_count,
  original_sha256, sent_at, sent_by, voided_at, void_reason, updated_by, deleted_at)
  on "sign_requests" to authenticated;

grant select (id, tenant_id, request_id, position, name, email, status, token_expires_at,
  verified_at, invited_at, viewed_at, signed_at, declined_at, decline_reason, created_at,
  updated_at) on "sign_request_signers" to authenticated;
-- Insert is granted on the whole table because Postgres checks every column a statement names,
-- defaults included; the insert policies above require the credential and outcome columns empty.
grant insert on "sign_request_signers" to authenticated;
grant update (token_hash, token_expires_at, invited_at) on "sign_request_signers"
  to authenticated;
grant delete on "sign_request_signers" to authenticated;

grant select on "sign_request_fields" to authenticated;
grant insert on "sign_request_fields" to authenticated;
grant delete on "sign_request_fields" to authenticated;

grant select (id, tenant_id, request_id, signer_id, actor_user_id, event, created_at)
  on "sign_request_events" to authenticated;
grant insert on "sign_request_events" to authenticated;

--> statement-breakpoint

-- Signature requests belong to the document library feature (ADR-038).
do $$
declare t text;
begin
  foreach t in array array['sign_requests', 'sign_request_signers', 'sign_request_fields',
                           'sign_request_events'] loop
    execute format(
      'create policy feature_switch on public.%I as restrictive for all to authenticated
         using ((select app.feature_enabled((select app.active_tenant_id()), %L)))
         with check ((select app.feature_enabled((select app.active_tenant_id()), %L)))',
      t, 'files', 'files');
  end loop;
end $$;

--> statement-breakpoint

-- Existing businesses: the people who already manage the library may send for signature.
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'files.request_signatures', null
from public.roles r
where r.key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;
