-- General staff see only their own shifts. Seeing everyone's needs the new rosters.view_all
-- (owners and managers), or rosters.manage. See docs/permissions.md.

drop policy roster_shift_read on "roster_shifts";

create policy roster_shift_read on "roster_shifts" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
      or (
        exists (
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

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'rosters.view_all', null
from public.roles r
where r.key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;
