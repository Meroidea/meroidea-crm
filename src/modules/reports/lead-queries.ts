import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

import { scopeFilter } from '@/lib/permissions/scope';
import { contactScope } from '@/modules/contacts/access';
import { contacts } from '@/db/schema';
import { readCrmSettings } from '@/modules/leads/settings';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type { ReportRange } from './queries';

/*
 * Lead reports (docs/leads.md §7). A "lead" is a contact with a lead status. Figures about how
 * leads were worked follow the leads created in the period (a cohort), so a lead is counted once
 * however long it takes; handover decisions follow the events in the period; the SLA and owner
 * views are as things stand now. Every query is limited to the viewer's reports scope, where a
 * lead's originator and the rep it was handed to count as responsible alongside its owner.
 */

export type LeadSourceRow = {
  source: string;
  subSource: string | null;
  created: number;
  contacted: number;
  qualified: number;
  converted: number;
  closed: number;
  won: number;
};

export type SdrRow = {
  name: string;
  leads: number;
  contacted: number;
  avgHoursToFirstContact: number | null;
  withinSla: number;
  handedOver: number;
  accepted: number;
  rejected: number;
};

export type RepRow = {
  name: string;
  received: number;
  accepted: number;
  rejected: number;
  avgHoursToDecide: number | null;
  waiting: number;
  overdue: number;
};

export type OwnerRow = {
  name: string;
  new: number;
  working: number;
  returned: number;
  pending: number;
  converted: number;
  closed: number;
  total: number;
};

export type LeadReports = {
  range: ReportRange;
  sla: {
    firstContactHours: number;
    unassignedHours: number;
    staleLeadDays: number;
    unassignedOver: number;
    firstContactOverdue: number;
    acceptanceOverdue: number;
    stale: number;
  };
  funnel: { step: string; count: number }[];
  bySource: LeadSourceRow[];
  sdr: SdrRow[];
  reps: RepRow[];
  disqualifyReasons: { name: string; count: number }[];
  rejectReasons: { name: string; count: number }[];
  owners: OwnerRow[];
};

const EXISTS_EVENT = (type: string) =>
  sql`exists (select 1 from activities a where a.tenant_id = contacts.tenant_id
    and a.contact_id = contacts.id and a.deleted_at is null and a.type = ${type})`;

async function rows<T>(tx: Tx, query: SQL): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

export async function getLeadReports(ctx: TenantContext, range: ReportRange): Promise<LeadReports> {
  requirePermission(ctx, 'reports.view');
  const { sla } = readCrmSettings(ctx.tenant.settings);
  const since = sql`${new Date(Date.now() - range * 86_400_000).toISOString()}::timestamptz`;
  const scope = scopeFilter(ctx, 'reports.view', contacts, contactScope) ?? sql`true`;
  const leads = sql`contacts.tenant_id = ${ctx.tenantId} and contacts.deleted_at is null
    and contacts.lead_status_id is not null and ${scope}`;
  const statusJoin = sql`join lead_statuses st
    on st.tenant_id = contacts.tenant_id and st.id = contacts.lead_status_id`;
  const firstContactDue = sql`coalesce(contacts.assigned_at, contacts.created_at)
    + make_interval(hours => ${sla.firstContactHours})`;

  return withRls(ctx, async (tx) => {
    const bySource = await rows<LeadSourceRow>(
      tx,
      sql`select coalesce(ls.name, 'Not recorded') as "source", sub.name as "subSource",
          count(*)::int as "created",
          count(contacts.first_contacted_at)::int as "contacted",
          count(*) filter (where contacts.converted_at is not null or ${EXISTS_EVENT('handover')})::int as "qualified",
          count(contacts.converted_at)::int as "converted",
          count(*) filter (where st.kind = 'closed')::int as "closed",
          count(*) filter (where exists (select 1 from opportunities o
            where o.tenant_id = contacts.tenant_id and o.contact_id = contacts.id
              and o.deleted_at is null and o.status = 'won'))::int as "won"
        from contacts ${statusJoin}
        left join lead_sources ls on ls.tenant_id = contacts.tenant_id and ls.id = contacts.source_id
        left join lead_sub_sources sub
          on sub.tenant_id = contacts.tenant_id and sub.id = contacts.sub_source_id
        where ${leads} and contacts.created_at >= ${since}
        group by 1, 2
        order by 3 desc, 1, 2`,
    );
    const total = (key: keyof LeadSourceRow) =>
      bySource.reduce((sum, row) => sum + (row[key] as number), 0);
    const funnel = [
      { step: 'Captured', count: total('created') },
      { step: 'Contacted', count: total('contacted') },
      { step: 'Qualified', count: total('qualified') },
      { step: 'Converted', count: total('converted') },
      { step: 'Won', count: total('won') },
    ];

    // The SDR/BDR is whoever worked the lead first: its originator once handed over, else its owner.
    const sdr = await rows<SdrRow>(
      tx,
      sql`select coalesce(u.full_name, 'Unassigned') as "name",
          count(*)::int as "leads",
          count(contacts.first_contacted_at)::int as "contacted",
          round((avg(extract(epoch from (contacts.first_contacted_at
            - coalesce(contacts.assigned_at, contacts.created_at))) / 3600)
            filter (where contacts.first_contacted_at is not null))::numeric, 1)::float
            as "avgHoursToFirstContact",
          count(*) filter (where contacts.first_contacted_at <= ${firstContactDue})::int as "withinSla",
          count(*) filter (where ${EXISTS_EVENT('handover')})::int as "handedOver",
          count(*) filter (where ${EXISTS_EVENT('handover_accepted')})::int as "accepted",
          count(*) filter (where ${EXISTS_EVENT('handover_rejected')})::int as "rejected"
        from contacts
        left join users u on u.id = coalesce(contacts.originator_user_id, contacts.owner_user_id)
        where ${leads} and contacts.created_at >= ${since}
        group by coalesce(contacts.originator_user_id, contacts.owner_user_id), u.full_name
        order by 2 desc`,
    );

    // Handover decisions in the period, credited to the rep the lead was handed to.
    const decided = await rows<Omit<RepRow, 'waiting' | 'overdue'> & { repId: string }>(
      tx,
      sql`select e.rep_id as "repId", coalesce(u.full_name, 'Former member') as "name",
          count(*) filter (where e.type = 'handover')::int as "received",
          count(*) filter (where e.type = 'handover_accepted')::int as "accepted",
          count(*) filter (where e.type = 'handover_rejected')::int as "rejected",
          round((avg(extract(epoch from (e.occurred_at - e.handed_at)) / 3600)
            filter (where e.type <> 'handover' and e.handed_at is not null))::numeric, 1)::float
            as "avgHoursToDecide"
        from (
          select a.type, a.occurred_at,
            case a.type
              when 'handover' then a.metadata ->> 'toUserId'
              when 'handover_accepted' then coalesce(a.metadata ->> 'acceptedFor', a.actor_user_id::text)
              else coalesce(a.metadata ->> 'rejectedFor', a.actor_user_id::text)
            end as rep_id,
            (select max(h.occurred_at) from activities h
              where h.tenant_id = a.tenant_id and h.contact_id = a.contact_id
                and h.type = 'handover' and h.occurred_at <= a.occurred_at) as handed_at
          from activities a
          join contacts on contacts.tenant_id = a.tenant_id and contacts.id = a.contact_id
          where a.tenant_id = ${ctx.tenantId} and a.deleted_at is null
            and a.type in ('handover', 'handover_accepted', 'handover_rejected')
            and a.occurred_at >= ${since} and ${leads}
        ) e
        left join users u on u.id::text = e.rep_id
        where e.rep_id is not null
        group by 1, 2`,
    );
    const waiting = await rows<{ repId: string; name: string; waiting: number; overdue: number }>(
      tx,
      sql`select contacts.handover_to_user_id::text as "repId",
          coalesce(u.full_name, 'Former member') as "name",
          count(*)::int as "waiting",
          count(*) filter (where contacts.handover_due_at < now())::int as "overdue"
        from contacts ${statusJoin}
        left join users u on u.id = contacts.handover_to_user_id
        where ${leads} and st.kind = 'pending_acceptance'
          and contacts.handover_to_user_id is not null
        group by 1, 2`,
    );
    const repIds = [...new Set([...decided, ...waiting].map((row) => row.repId))];
    const reps: RepRow[] = repIds
      .map((repId) => {
        const d = decided.find((row) => row.repId === repId);
        const w = waiting.find((row) => row.repId === repId);
        return {
          name: d?.name ?? w?.name ?? 'Former member',
          received: d?.received ?? 0,
          accepted: d?.accepted ?? 0,
          rejected: d?.rejected ?? 0,
          avgHoursToDecide: d?.avgHoursToDecide ?? null,
          waiting: w?.waiting ?? 0,
          overdue: w?.overdue ?? 0,
        };
      })
      .sort((a, b) => b.received - a.received || b.waiting - a.waiting);

    const [now] = await rows<
      Omit<LeadReports['sla'], 'firstContactHours' | 'unassignedHours' | 'staleLeadDays'>
    >(
      tx,
      sql`select
          count(*) filter (where st.kind in ('new', 'working', 'returned')
            and contacts.owner_user_id is null
            and contacts.created_at < now() - make_interval(hours => ${sla.unassignedHours}))::int
            as "unassignedOver",
          count(*) filter (where st.kind in ('new', 'working', 'returned')
            and contacts.first_contacted_at is null and ${firstContactDue} < now())::int
            as "firstContactOverdue",
          count(*) filter (where st.kind = 'pending_acceptance'
            and contacts.handover_due_at < now())::int as "acceptanceOverdue",
          count(*) filter (where st.kind in ('new', 'working', 'returned')
            and coalesce(contacts.last_activity_at, contacts.created_at)
              < now() - make_interval(days => ${sla.staleLeadDays}))::int as "stale"
        from contacts ${statusJoin}
        where ${leads}`,
    );

    const disqualifyReasons = await rows<{ name: string; count: number }>(
      tx,
      sql`select coalesce(r.name, 'No reason') as "name", count(*)::int as "count"
        from contacts ${statusJoin}
        left join lead_reasons r on r.tenant_id = contacts.tenant_id and r.id = contacts.lead_reason_id
        where ${leads} and st.kind = 'closed' and contacts.lead_status_changed_at >= ${since}
        group by 1 order by 2 desc`,
    );
    const rejectReasons = await rows<{ name: string; count: number }>(
      tx,
      sql`select coalesce(r.name, 'Unknown') as "name", count(*)::int as "count"
        from activities a
        join contacts on contacts.tenant_id = a.tenant_id and contacts.id = a.contact_id
        left join lead_reasons r on r.tenant_id = a.tenant_id and r.id::text = a.metadata ->> 'reasonId'
        where a.tenant_id = ${ctx.tenantId} and a.deleted_at is null
          and a.type = 'handover_rejected' and a.occurred_at >= ${since} and ${leads}
        group by 1 order by 2 desc`,
    );

    const owners = await rows<OwnerRow>(
      tx,
      sql`select coalesce(u.full_name, 'Unassigned') as "name",
          count(*) filter (where st.kind = 'new')::int as "new",
          count(*) filter (where st.kind = 'working')::int as "working",
          count(*) filter (where st.kind = 'returned')::int as "returned",
          count(*) filter (where st.kind = 'pending_acceptance')::int as "pending",
          count(*) filter (where st.kind = 'converted')::int as "converted",
          count(*) filter (where st.kind = 'closed')::int as "closed",
          count(*)::int as "total"
        from contacts ${statusJoin}
        left join users u on u.id = contacts.owner_user_id
        where ${leads}
        group by contacts.owner_user_id, u.full_name
        order by "total" desc`,
    );

    return {
      range,
      sla: {
        firstContactHours: sla.firstContactHours,
        unassignedHours: sla.unassignedHours,
        staleLeadDays: sla.staleLeadDays,
        unassignedOver: now?.unassignedOver ?? 0,
        firstContactOverdue: now?.firstContactOverdue ?? 0,
        acceptanceOverdue: now?.acceptanceOverdue ?? 0,
        stale: now?.stale ?? 0,
      },
      funnel,
      bySource,
      sdr,
      reps,
      disqualifyReasons,
      rejectReasons,
      owners,
    };
  });
}
