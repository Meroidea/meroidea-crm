import { contacts } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { scopeDecision, type ScopeContext, type ScopeOptions } from '@/lib/permissions/scope';

/**
 * Besides its owner, a lead is the responsibility of the SDR/BDR who originated it and of the
 * person it is handed to (docs/leads.md): each sees it within their own scope. Every scope check
 * on contacts goes through these two helpers so the rule is the same everywhere.
 */
export const contactScope: ScopeOptions = {
  alsoResponsible: [contacts.originatorUserId, contacts.handoverToUserId],
};

export function contactRecord(row: {
  ownerUserId: string | null;
  originatorUserId: string | null;
  handoverToUserId: string | null;
}) {
  return {
    ownerUserId: row.ownerUserId,
    alsoResponsible: [row.originatorUserId, row.handoverToUserId],
  };
}

/**
 * Who may own a contact: yourself always; someone else (or nobody) only with contacts.assign,
 * and only a colleague inside that grant's scope.
 */
export function assertCanAssignContact(ctx: ScopeContext, ownerUserId: string | null): void {
  if (ownerUserId === ctx.userId) return;
  const decision = scopeDecision(ctx, 'contacts.assign');
  const allowed =
    decision.kind === 'all' ||
    (decision.kind === 'owners' && ownerUserId !== null && decision.userIds.includes(ownerUserId));
  if (!allowed) {
    throw new AppError('FORBIDDEN', 'You can’t assign records to that person.', {
      ownerUserId: ['Choose yourself or someone in your team'],
    });
  }
}
