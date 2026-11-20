CREATE TABLE "ai_pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_pending_actions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "ai_pending_actions_kind_check" CHECK ("ai_pending_actions"."kind" in ('invoice', 'roster', 'staff_email', 'record_update')),
	CONSTRAINT "ai_pending_actions_status_check" CHECK ("ai_pending_actions"."status" in ('pending', 'executing', 'approved', 'rejected', 'failed', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "ai_pending_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "ai_pending_actions_creator_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_pending_actions_tenant_creator_idx" ON "ai_pending_actions" USING btree ("tenant_id","created_by","created_at");--> statement-breakpoint

-- ── Meroidea AI pending actions (ADR-064) ─────────────────────────────────────────────────────
create trigger set_updated_at before update on "ai_pending_actions"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

-- The life of a proposal, enforced here so no code path can run one twice or edit one that has
-- been decided: pending may be edited, claimed for execution, rejected or lapse; a claimed one
-- either succeeds or fails, or returns to pending when a business rule refused it (nothing was
-- written). approved, rejected, failed and expired are final. Only a pending proposal's payload
-- and summary may change, and who asked never changes.
create or replace function app.guard_ai_pending_action() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.tenant_id <> old.tenant_id or new.created_by <> old.created_by or new.kind <> old.kind
     or new.created_at <> old.created_at then
    raise exception 'A proposal''s business, owner and kind never change' using errcode = '42501';
  end if;
  if old.status in ('approved', 'rejected', 'failed', 'expired') then
    raise exception 'This proposal has already been decided' using errcode = '42501';
  end if;
  if (new.payload is distinct from old.payload or new.summary is distinct from old.summary)
     and not (old.status = 'pending' and new.status = 'pending') then
    raise exception 'Only a pending proposal can be edited' using errcode = '42501';
  end if;
  if not (
    (old.status = 'pending' and new.status in ('pending', 'executing', 'rejected', 'expired'))
    or (old.status = 'executing' and new.status in ('approved', 'failed', 'pending'))
  ) then
    raise exception 'A proposal cannot go from % to %', old.status, new.status
      using errcode = '42501';
  end if;
  return new;
end;
$$;

--> statement-breakpoint

create trigger guard_ai_pending_action before update on "ai_pending_actions"
  for each row execute function app.guard_ai_pending_action();

--> statement-breakpoint

alter table "ai_pending_actions" enable row level security;

-- A proposal belongs to the person who asked for it: nobody else in the business sees it, the
-- admin included, because it can carry what they were drafting (an email, an invoice).
create policy ai_pending_actions_read on "ai_pending_actions" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and created_by = (select app.user_id())
  );
create policy ai_pending_actions_insert on "ai_pending_actions" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and created_by = (select app.user_id())
    and status = 'pending' and result is null and decided_by is null
    and (select app.has_permission((select app.active_tenant_id()), 'assistant.use'))
  );
-- Decided only by the person who asked, and recorded as decided by them.
create policy ai_pending_actions_update on "ai_pending_actions" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and created_by = (select app.user_id())
  )
  with check (
    created_by = (select app.user_id())
    and (decided_by is null or decided_by = (select app.user_id()))
  );

-- Owned by one feature: hidden entirely while it is switched off (ADR-038).
create policy feature_switch on "ai_pending_actions" as restrictive for all to authenticated
  using ((select app.feature_enabled((select app.active_tenant_id()), 'assistant')))
  with check ((select app.feature_enabled((select app.active_tenant_id()), 'assistant')));

-- No delete: a proposal is kept as the record of what the assistant suggested.
grant select, insert on "ai_pending_actions" to authenticated;
grant update (payload, summary, status, result, error, decided_by, decided_at)
  on "ai_pending_actions" to authenticated;
