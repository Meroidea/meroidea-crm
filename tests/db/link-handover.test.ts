import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { sendPasswordLink } from '@/modules/access/service';
import type { TenantContext } from '@/server/context';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Email is set up and every message goes out: the case where nobody but the recipient may hold
// the one-time link.
const outbox = vi.hoisted(() => [] as { to: string; text: string }[]);
vi.mock('@/server/email', () => ({
  isEmailConfigured: () => true,
  sendEmail: async (message: { to: string; text: string }) => {
    outbox.push(message);
    return { sent: true };
  },
}));

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
let tenantId: string;
let userIds: string[];
let owner: TenantContext;
let colleagueId: string;

beforeAll(async () => {
  const workspace = await createWorkspace(`Handover ${stamp}`, mail('handover-owner'));
  tenantId = workspace.tenantId;
  colleagueId = await addMember(tenantId, mail('handover-colleague'), 'Cole League', 'member');
  userIds = [workspace.ownerId, colleagueId];
  owner = await contextFor(workspace.ownerId, tenantId);
});

afterAll(async () => {
  await destroyWorkspace(tenantId, userIds);
});

describe('one-time links once they have been emailed', () => {
  it('never hands a colleague’s password link back to the admin who asked for it', async () => {
    const result = await sendPasswordLink(owner, colleagueId);
    expect(result).toEqual({ emailed: true });
    expect('link' in result).toBe(false);
    // It went to the colleague's own inbox instead.
    expect(outbox.at(-1)?.to).toBe(mail('handover-colleague'));
    expect(outbox.at(-1)?.text).toContain('/auth/confirm');
  });
});
