import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import type { Grant, PermissionKey } from '@/lib/permissions/catalog';
import {
  assertCanAccess,
  canAccess,
  scopeDecision,
  type ScopeContext,
} from '@/lib/permissions/scope';

function ctx(
  grants: Partial<Record<PermissionKey, Grant>>,
  settings: Record<string, unknown> = {},
): ScopeContext {
  return {
    userId: 'me',
    teamUserIds: ['me', 'teammate'],
    grants: new Map(Object.entries(grants) as [PermissionKey, Grant][]),
    tenant: { settings },
  };
}

describe('record scope', () => {
  it('own scope sees only records owned by me', () => {
    const own = ctx({ 'contacts.view': 'own' });
    expect(canAccess(own, 'contacts.view', { ownerUserId: 'me' })).toBe(true);
    expect(canAccess(own, 'contacts.view', { ownerUserId: 'teammate' })).toBe(false);
    expect(canAccess(own, 'contacts.view', { ownerUserId: null })).toBe(false);
  });

  it('team scope adds my team, not the rest of the workspace', () => {
    const team = ctx({ 'contacts.view': 'team' });
    expect(canAccess(team, 'contacts.view', { ownerUserId: 'teammate' })).toBe(true);
    expect(canAccess(team, 'contacts.view', { ownerUserId: 'stranger' })).toBe(false);
  });

  it('all scope and unscoped grants see everything, including unassigned', () => {
    expect(canAccess(ctx({ 'contacts.view': 'all' }), 'contacts.view', { ownerUserId: null })).toBe(
      true,
    );
    expect(scopeDecision(ctx({ 'documents.view': true }), 'documents.view')).toEqual({
      kind: 'all',
    });
  });

  it('no grant sees nothing', () => {
    expect(canAccess(ctx({}), 'contacts.view', { ownerUserId: 'me' })).toBe(false);
  });

  it('shows unassigned records to narrow scopes only when the workspace shares a claim queue', () => {
    const shared = ctx({ 'contacts.view': 'own' }, { consultantCanSeeUnassigned: true });
    expect(canAccess(shared, 'contacts.view', { ownerUserId: null })).toBe(true);
  });

  it('reports an out-of-scope record as not found, never forbidden', () => {
    expect(() =>
      assertCanAccess(ctx({ 'contacts.view': 'own' }), 'contacts.view', { ownerUserId: 'x' }),
    ).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }) as AppError);
  });
});
