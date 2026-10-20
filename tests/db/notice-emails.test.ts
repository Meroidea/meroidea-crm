import { describe, expect, it, vi } from 'vitest';

import { sendNoticeEmails } from '@/modules/notifications/service';

// The email service: every message is recorded, and one address always fails.
const outbox = vi.hoisted(() => [] as { to: string; subject: string }[]);
vi.mock('@/server/email', () => ({
  isEmailConfigured: () => true,
  sendEmail: async (message: { to: string; subject: string }) => {
    if (message.to === 'down@example.com') return { sent: false, reason: 'failed' };
    outbox.push(message);
    return { sent: true };
  },
}));

describe('notice emails', () => {
  it('sends one email for many notices of one kind, not one each', async () => {
    const pending = [1, 2, 3].map((n) => ({
      id: `n${n}`,
      userId: 'u1',
      type: 'first_contact_overdue',
      url: `/contacts/${n}`,
    }));
    const { failed } = await sendNoticeEmails('Cafe', pending, [
      { id: 'u1', email: 'owner@example.com' },
    ]);
    expect(failed).toEqual([]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.subject).toContain('(3)');
  });

  it('hands back the notices whose email failed, so they can be tried again', async () => {
    const pending = [{ id: 'x', userId: 'u2', type: 'task_overdue', url: '/my-day' }];
    const { failed } = await sendNoticeEmails('Cafe', pending, [
      { id: 'u2', email: 'down@example.com' },
    ]);
    expect(failed.map((item) => item.id)).toEqual(['x']);
  });
});
