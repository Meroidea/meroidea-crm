import { describe, expect, it } from 'vitest';

import { findCanned, renderCannedReply } from '@/modules/social/canned';
import { senderNames } from '@/modules/leads/channel-intake';

describe('saved reply placeholders', () => {
  const values = { contactFirstName: 'Kim', contactName: 'Kim Lee', agentName: 'Avery' };

  it('fills in the customer and the agent', () => {
    expect(renderCannedReply('Hi {{contact.first_name}}, this is {{ agent.name }}.', values)).toBe(
      'Hi Kim, this is Avery.',
    );
    expect(renderCannedReply('For {{contact.name}}', values)).toBe('For Kim Lee');
  });

  it('leaves no stray space where a value is unknown', () => {
    expect(
      renderCannedReply('Hi {{contact.first_name}}, thanks!', {
        ...values,
        contactFirstName: null,
      }),
    ).toBe('Hi, thanks!');
  });

  it('keeps an unknown placeholder as typed so the mistake shows', () => {
    expect(renderCannedReply('Order {{order.number}}', values)).toBe('Order {{order.number}}');
  });
});

describe('finding a saved reply', () => {
  const replies = [
    { title: 'Opening hours', shortcut: 'hours' },
    { title: 'Delivery areas', shortcut: 'delivery' },
    { title: 'Thanks for your order', shortcut: null },
  ];

  it('puts shortcut and title starts before matches inside', () => {
    expect(findCanned(replies, 'del').map((reply) => reply.title)).toEqual(['Delivery areas']);
    expect(findCanned(replies, 'or').map((reply) => reply.title)).toEqual([
      'Thanks for your order',
    ]);
    expect(findCanned(replies, 'ho').map((reply) => reply.title)).toEqual(['Opening hours']);
  });

  it('offers everything for an empty search', () => {
    expect(findCanned(replies, '')).toHaveLength(3);
  });
});

describe('a new lead’s name from a channel', () => {
  it('splits the first name from the rest', () => {
    expect(senderNames('Sam Lee Chen', 'whatsapp')).toEqual({
      firstName: 'Sam',
      lastName: 'Lee Chen',
    });
  });

  it('names the channel when the sender gave no name', () => {
    expect(senderNames(null, 'instagram')).toEqual({
      firstName: 'Instagram sender',
      lastName: null,
    });
    expect(senderNames('   ', 'whatsapp').firstName).toBe('WhatsApp sender');
  });
});
