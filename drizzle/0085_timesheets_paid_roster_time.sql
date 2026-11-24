-- Timesheets show what a pay run paid (ADR-083).
--
-- 1. Time entries may come from the roster: a shift paid with its rostered hours is recorded as
--    approved time, so Timesheets and its export show the authorised hours. Widening the check
--    only allows a new value; every existing row still passes.
alter table "time_entries" drop constraint time_entries_source_known;
--> statement-breakpoint
alter table "time_entries" add constraint time_entries_source_known
  check (source in ('clock', 'manual', 'roster'));
--> statement-breakpoint

-- 2. Periods already authorised for pay with their rostered hours get the same record now: each
--    assigned, live shift of the roster, unless the person already has time recorded against it
--    or overlapping it. A roster paid from approved timesheets is left alone, since a shift
--    nobody worked was not paid. The time counts as approved by whoever authorised the roster,
--    when they did.
insert into "time_entries" (
  tenant_id, user_id, shift_id, clock_in, clock_out, break_minutes,
  source, status, decided_by, decided_at, created_by, updated_by
)
select
  s.tenant_id, s.user_id, s.id, s.starts_at, s.ends_at, s.break_minutes,
  'roster', 'approved', r.authorised_by, r.authorised_at, r.authorised_by, r.authorised_by
from "roster_shifts" s
join "rosters" r on r.tenant_id = s.tenant_id and r.id = s.roster_id
where r.authorised_at is not null
  and r.deleted_at is null
  and s.deleted_at is null
  and s.user_id is not null
  -- Still a member of the business (time entries reference memberships).
  and exists (
    select 1 from "tenant_memberships" m
    where m.tenant_id = s.tenant_id and m.user_id = s.user_id
  )
  and not exists (
    select 1 from "audit_logs" a
    where a.tenant_id = r.tenant_id
      and a.entity_type = 'roster'
      and a.entity_id = r.id
      and a.context ->> 'hoursFrom' = 'timesheets'
  )
  and not exists (
    select 1 from "time_entries" e
    where e.tenant_id = s.tenant_id
      and e.deleted_at is null
      and (
        e.shift_id = s.id
        or (
          e.user_id = s.user_id
          and e.clock_out is not null
          and e.clock_in < s.ends_at
          and e.clock_out > s.starts_at
        )
      )
  );
