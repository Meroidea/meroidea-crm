import 'server-only';

import { and, asc, count, eq, inArray, isNull, or } from 'drizzle-orm';

import {
  contacts,
  leadStatuses,
  opportunities,
  routingRules,
  tenantMemberships,
} from '@/db/schema';
import type { Tx } from '@/server/db/with-rls';

/** What a routing rule can look at. Text comparisons ignore case and surrounding spaces. */
export type RoutableLead = {
  leadType: 'b2b' | 'b2c' | null;
  sourceId: string | null;
  subSourceId: string | null;
  country: string | null;
  region: string | null;
  industry: string | null;
  companySize: string | null;
  language: string | null;
  interest: string | null;
};

export const CONDITION_KEYS = [
  'sourceIds',
  'subSourceIds',
  'countries',
  'regions',
  'industries',
  'companySizes',
  'languages',
  'interests',
] as const;

export type RuleConditions = Partial<Record<(typeof CONDITION_KEYS)[number], string[]>>;

const LEAD_VALUE: Record<(typeof CONDITION_KEYS)[number], (lead: RoutableLead) => string | null> = {
  sourceIds: (lead) => lead.sourceId,
  subSourceIds: (lead) => lead.subSourceId,
  countries: (lead) => lead.country,
  regions: (lead) => lead.region,
  industries: (lead) => lead.industry,
  companySizes: (lead) => lead.companySize,
  languages: (lead) => lead.language,
  interests: (lead) => lead.interest,
};

const tidy = (value: string) => value.trim().toLowerCase();

/** Every condition with values must contain the lead's value; empty conditions match all. */
export function ruleMatches(conditions: RuleConditions, lead: RoutableLead): boolean {
  return CONDITION_KEYS.every((key) => {
    const wanted = (conditions[key] ?? []).filter(Boolean);
    if (wanted.length === 0) return true;
    const value = LEAD_VALUE[key](lead);
    if (!value) return false;
    return wanted.map(tidy).includes(tidy(value));
  });
}

/** The next person after `last` in a fixed order, starting over at the top. */
export function nextInTurn(pool: string[], last: string | null): string | null {
  if (pool.length === 0) return null;
  const index = last ? pool.indexOf(last) : -1;
  return pool[(index + 1) % pool.length] ?? null;
}

/**
 * Picks who gets a lead under the business's rules (docs/leads.md §Routing): the first active
 * rule for this step and workflow whose conditions match, then the next person in turn or the
 * one with the fewest open items. Only active members of the business can be chosen. The rule
 * row is locked while choosing so two leads arriving together are not given to the same person.
 * Returns null when no rule applies; the lead then waits in the unassigned queue.
 */
export async function routeLead(
  tx: Tx,
  tenantId: string,
  lead: RoutableLead,
  stage: 'intake' | 'handover',
): Promise<string | null> {
  const rules = await tx
    .select()
    .from(routingRules)
    .where(
      and(
        eq(routingRules.tenantId, tenantId),
        eq(routingRules.stage, stage),
        eq(routingRules.isActive, true),
        lead.leadType
          ? or(isNull(routingRules.leadType), eq(routingRules.leadType, lead.leadType))
          : isNull(routingRules.leadType),
      ),
    )
    .orderBy(asc(routingRules.position), asc(routingRules.createdAt));

  for (const candidate of rules) {
    if (!ruleMatches(candidate.conditions as RuleConditions, lead)) continue;

    const [rule] = await tx
      .select()
      .from(routingRules)
      .where(and(eq(routingRules.tenantId, tenantId), eq(routingRules.id, candidate.id)))
      .limit(1)
      .for('update');
    if (!rule) continue;

    const members = await tx
      .select({ userId: tenantMemberships.userId, teamId: tenantMemberships.teamId })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, 'active'),
          eq(tenantMemberships.isSupport, false),
        ),
      );
    const pool = [
      ...rule.userIds.filter((id) => members.some((member) => member.userId === id)),
      ...members
        .filter((member) => rule.teamId && member.teamId === rule.teamId)
        .map((member) => member.userId)
        .filter((id) => !rule.userIds.includes(id))
        .sort(),
    ];
    if (pool.length === 0) continue;

    const chosen =
      rule.method === 'least_loaded'
        ? await leastLoaded(tx, tenantId, pool, stage)
        : nextInTurn(pool, rule.lastAssignedUserId);
    if (!chosen) continue;

    await tx
      .update(routingRules)
      .set({ lastAssignedUserId: chosen })
      .where(and(eq(routingRules.tenantId, tenantId), eq(routingRules.id, rule.id)));
    return chosen;
  }
  return null;
}

/** The person with the fewest open leads (intake) or open opportunities (handover); ties go in order. */
async function leastLoaded(
  tx: Tx,
  tenantId: string,
  pool: string[],
  stage: 'intake' | 'handover',
): Promise<string | null> {
  const load = new Map(pool.map((id) => [id, 0]));
  if (stage === 'intake') {
    const rows = await tx
      .select({ userId: contacts.ownerUserId, total: count() })
      .from(contacts)
      .innerJoin(
        leadStatuses,
        and(
          eq(leadStatuses.tenantId, contacts.tenantId),
          eq(leadStatuses.id, contacts.leadStatusId),
        ),
      )
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          isNull(contacts.deletedAt),
          inArray(contacts.ownerUserId, pool),
          inArray(leadStatuses.kind, ['new', 'working', 'returned']),
        ),
      )
      .groupBy(contacts.ownerUserId);
    for (const row of rows) if (row.userId) load.set(row.userId, row.total);
  } else {
    const rows = await tx
      .select({ userId: opportunities.ownerUserId, total: count() })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.tenantId, tenantId),
          isNull(opportunities.deletedAt),
          eq(opportunities.status, 'open'),
          inArray(opportunities.ownerUserId, pool),
        ),
      )
      .groupBy(opportunities.ownerUserId);
    for (const row of rows) if (row.userId) load.set(row.userId, row.total);
  }
  let best: string | null = null;
  for (const id of pool) {
    if (best === null || (load.get(id) ?? 0) < (load.get(best) ?? 0)) best = id;
  }
  return best;
}
