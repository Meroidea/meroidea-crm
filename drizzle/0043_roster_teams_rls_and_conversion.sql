-- Tables and columns from 0042: tenant isolation, who may write, integrity rules, and the
-- conversion of what was already there. Applied in the same migrate run as 0042.
-- See docs/database.md §7a and docs/permissions.md.

alter table "workforce_settings" add constraint workforce_settings_loadings_sane
  check (saturday_loading between 1 and 5
    and sunday_loading between 1 and 5
    and public_holiday_loading between 1 and 5);

alter table "roster_teams" add constraint roster_teams_color_known
  check (color in ('chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'));

-- Two live teams in a workspace never share a name, whatever the capitals.
create unique index roster_teams_tenant_name_key
  on "roster_teams" (tenant_id, lower(name)) where deleted_at is null;

--> statement-breakpoint

create trigger set_updated_at before update on "roster_teams"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "workforce_settings"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "roster_teams" enable row level security;
alter table "roster_team_members" enable row level security;
alter table "workforce_settings" enable row level security;
alter table "public_holidays" enable row level security;

-- Team names, the loadings and the holiday list are read by everyone in the workspace: a
-- person's own shift names its team. Who belongs to which team is for whoever builds or reads
-- the whole roster, plus each person's own rows. Only rosters.manage may write any of it.
create policy roster_teams_read on "roster_teams" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy roster_teams_insert on "roster_teams" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  );
create policy roster_teams_update on "roster_teams" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  );

create policy roster_team_members_read on "roster_team_members" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      user_id = (select app.user_id())
      or (select app.has_permission((select app.active_tenant_id()), 'rosters.view_all'))
      or (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
    )
  );
create policy roster_team_members_insert on "roster_team_members" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  );
create policy roster_team_members_delete on "roster_team_members" for delete to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  );

create policy workforce_settings_read on "workforce_settings" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy workforce_settings_insert on "workforce_settings" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  );
create policy workforce_settings_update on "workforce_settings" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  );

create policy public_holidays_read on "public_holidays" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy public_holidays_insert on "public_holidays" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  );
create policy public_holidays_delete on "public_holidays" for delete to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  );

-- Teams are soft-deleted; membership rows and holidays are plain lists and are removed outright.
grant select, insert, update on "roster_teams" to authenticated;
grant select, insert, delete on "roster_team_members" to authenticated;
grant select, insert, update on "workforce_settings" to authenticated;
grant select, insert, delete on "public_holidays" to authenticated;

--> statement-breakpoint

-- Staff now see a shift only once that shift has been published, not merely its roster, so a
-- shift added to a published roster stays private until it is published too.
drop policy roster_shift_read on "roster_shifts";

create policy roster_shift_read on "roster_shifts" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
      or (
        published_at is not null
        and exists (
          select 1 from public.rosters r
          where r.id = roster_shifts.roster_id
            and r.tenant_id = roster_shifts.tenant_id
            and r.status = 'published'
            and r.deleted_at is null
        )
        and (
          user_id = (select app.user_id())
          or (select app.has_permission((select app.active_tenant_id()), 'rosters.view_all'))
        )
      )
    )
  );

--> statement-breakpoint

-- Existing shifts. Those on a published roster have already been seen by staff; everything on
-- a draft is still unpublished, and a removed shift has nothing left to announce.
update public.roster_shifts s
set published_at = coalesce(r.published_at, s.updated_at), unpublished_changes = false
from public.rosters r
where r.tenant_id = s.tenant_id and r.id = s.roster_id
  and r.status = 'published' and s.deleted_at is null;

update public.roster_shifts set unpublished_changes = false where deleted_at is not null;

-- The single break figure was always time off the clock: one unpaid break.
update public.roster_shifts
set breaks = jsonb_build_array(jsonb_build_object('minutes', break_minutes, 'paid', false))
where break_minutes > 0;

--> statement-breakpoint

-- Free-text tags become teams: one per distinct tag in a workspace, with everyone who was
-- rostered under the tag as a member, so no existing shift becomes invalid.
insert into public.roster_teams (tenant_id, name, color)
select t.tenant_id, t.name,
  'chart-' || (((row_number() over (partition by t.tenant_id order by lower(t.name)) - 1) % 5) + 1)
from (
  select tenant_id, min(btrim(position)) as name
  from public.roster_shifts
  where btrim(coalesce(position, '')) <> ''
  group by tenant_id, lower(btrim(position))
) t;

update public.roster_shifts s
set team_id = t.id
from public.roster_teams t
where t.tenant_id = s.tenant_id
  and lower(t.name) = lower(btrim(s.position))
  and t.deleted_at is null;

insert into public.roster_team_members (tenant_id, team_id, user_id)
select distinct s.tenant_id, s.team_id, s.user_id
from public.roster_shifts s
where s.team_id is not null and s.user_id is not null
on conflict do nothing;
