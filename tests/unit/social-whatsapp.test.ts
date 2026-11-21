import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadMedia, MediaRefused } from '@/modules/social/media';
import { isRateLimited } from '@/modules/social/providers/http';
import {
  parseTemplate,
  templatePlaceholders,
  whatsappReason,
  whatsappRecipient,
} from '@/modules/social/providers/whatsapp';
import {
  contentOf,
  parseWhatsAppWebhook,
  phoneDigits,
} from '@/modules/social/providers/whatsapp-webhook';
import { createTemplateSchema, templateReplySchema } from '@/modules/social/schemas';
import { renderTemplate, replyWindow } from '@/modules/social/service';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

afterEach(() => {
  vi.restoreAllMocks();
});

const change = (
  field: string,
  value: Record<string, unknown>,
  object = 'whatsapp_business_account',
) => ({
  object,
  entry: [
    {
      id: 'WABA1',
      changes: [
        {
          field,
          value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PN1' }, ...value },
        },
      ],
    },
  ],
});

describe('reading WhatsApp webhooks', () => {
  it('reads a customer’s text with their profile name and number', () => {
    const parsed = parseWhatsAppWebhook(
      change('messages', {
        contacts: [{ profile: { name: 'Jamie' }, wa_id: '61400111222' }],
        messages: [
          {
            from: '61400111222',
            id: 'wamid.1',
            timestamp: '1800000000',
            type: 'text',
            text: { body: 'Hi' },
          },
        ],
      }),
    );
    expect(parsed.messages).toEqual([
      {
        phoneNumberId: 'PN1',
        participantId: '61400111222',
        participantPhone: '61400111222',
        participantName: 'Jamie',
        message: {
          externalId: 'wamid.1',
          direction: 'inbound',
          sentAt: new Date(1_800_000_000_000),
          body: 'Hi',
          attachments: [],
        },
      },
    ]);
  });

  it('keeps a media id, never the token-only link, and the caption as text', () => {
    expect(
      contentOf({
        type: 'image',
        image: { id: 'M1', caption: 'This one', url: 'https://lookaside.fbsbx.com/x' },
      }),
    ).toEqual({ body: 'This one', attachments: [{ type: 'image', mediaId: 'M1' }] });
    expect(contentOf({ type: 'document', document: { id: 'D1', filename: 'menu.pdf' } })).toEqual({
      body: 'menu.pdf',
      attachments: [{ type: 'document', mediaId: 'D1' }],
    });
  });

  it('writes out locations, contact cards and button replies, and skips reactions and edits', () => {
    expect(
      contentOf({
        type: 'location',
        location: { latitude: -33.8688, longitude: 151.2093, name: 'Cafe', address: '1 George St' },
      })?.body,
    ).toBe(
      'Shared a location\nCafe, 1 George St\nhttps://www.google.com/maps?q=-33.868800,151.209300',
    );
    expect(
      contentOf({
        type: 'contacts',
        contacts: [{ name: { formatted_name: 'Sam' }, phones: [{ phone: '+61 400 000 000' }] }],
      })?.body,
    ).toBe('Shared a contact: Sam +61 400 000 000');
    expect(
      contentOf({ type: 'interactive', interactive: { button_reply: { id: 'b', title: 'Yes' } } })
        ?.body,
    ).toBe('Yes');
    expect(contentOf({ type: 'reaction', reaction: { message_id: 'x', emoji: '👍' } })).toBeNull();
    expect(contentOf({ type: 'unsupported', unsupported: { type: 'edit' } })).toBeNull();
    expect(contentOf({ type: 'unsupported', unsupported: { type: 'poll_update' } })?.body).toMatch(
      /cannot show/,
    );
  });

  it('reads delivery states and failures with their code', () => {
    const parsed = parseWhatsAppWebhook(
      change('messages', {
        statuses: [
          { id: 'wamid.2', status: 'read', timestamp: '1800000001' },
          {
            id: 'wamid.3',
            status: 'failed',
            timestamp: '1800000002',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
          { id: 'wamid.4', status: 'deleted', timestamp: '1800000003' },
        ],
      }),
    );
    expect(parsed.statuses).toEqual([
      {
        phoneNumberId: 'PN1',
        messageId: 'wamid.2',
        status: 'read',
        at: new Date(1_800_000_001_000),
        errorCode: null,
        errorTitle: null,
      },
      {
        phoneNumberId: 'PN1',
        messageId: 'wamid.3',
        status: 'failed',
        at: new Date(1_800_000_002_000),
        errorCode: 131047,
        errorTitle: 'Re-engagement message',
      },
    ]);
  });

  it('reads messages sent from the phone app, and their edits and deletions', () => {
    const parsed = parseWhatsAppWebhook(
      change('smb_message_echoes', {
        message_echoes: [
          {
            from: '61400000000',
            to: '61400111222',
            id: 'wamid.E',
            timestamp: '1800000000',
            type: 'text',
            text: { body: 'On my way' },
          },
          {
            to: '61400111222',
            id: 'wamid.X',
            timestamp: '1800000001',
            type: 'revoke',
            revoke: { original_message_id: 'wamid.E' },
          },
        ],
      }),
    );
    expect(parsed.messages[0]).toMatchObject({
      participantId: '61400111222',
      message: { direction: 'outbound', body: 'On my way' },
    });
    expect(parsed.changes).toEqual([
      { phoneNumberId: 'PN1', originalId: 'wamid.E', kind: 'revoke', body: null },
    ]);
  });

  it('reads history threads: who wrote, the business’s delivery state, placeholders and refusals', () => {
    const parsed = parseWhatsAppWebhook(
      change('history', {
        history: [
          {
            metadata: { phase: 0, progress: 40 },
            threads: [
              {
                id: '61400111222',
                context: { wa_id: '61400111222' },
                messages: [
                  {
                    from: '61400111222',
                    id: 'h1',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Hello' },
                  },
                  {
                    from: '61400000000',
                    id: 'h2',
                    timestamp: '1700000060',
                    type: 'text',
                    text: { body: 'Hi!' },
                    history_context: { status: 'DELIVERED' },
                  },
                  {
                    from: '61400111222',
                    id: 'h3',
                    timestamp: '1700000120',
                    type: 'media_placeholder',
                  },
                ],
              },
            ],
          },
          { metadata: { phase: 1 }, errors: [{ code: 2593109 }], threads: [] },
        ],
      }),
    );
    const [first, second] = parsed.history;
    expect(first?.progress).toBe(40);
    expect(
      first?.threads[0]?.messages.map((message) => [message.direction, message.status]),
    ).toEqual([
      ['inbound', undefined],
      ['outbound', 'delivered'],
      ['inbound', undefined],
    ]);
    expect(first?.threads[0]?.messages[2]?.attachments).toEqual([
      { type: 'file', placeholder: true },
    ]);
    expect(second?.declined).toBe(true);
  });

  it('reads template reviews and ignores other Meta objects', () => {
    const parsed = parseWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA1',
          changes: [
            {
              field: 'message_template_status_update',
              value: { event: 'APPROVED', message_template_id: 1234, reason: 'NONE' },
            },
          ],
        },
      ],
    });
    expect(parsed.templates).toEqual([
      { wabaId: 'WABA1', templateId: '1234', status: 'approved', reason: null },
    ]);
    expect(parseWhatsAppWebhook(change('messages', {}, 'page')).messages).toEqual([]);
    expect(phoneDigits('+61 400 111 222')).toBe('61400111222');
    expect(phoneDigits('12')).toBeNull();
  });
});

describe('WhatsApp templates', () => {
  it('finds placeholders in order, and fills them in', () => {
    expect(templatePlaceholders('Hi {{1}}, order {{2}} for {{1}}')).toEqual(['1', '2']);
    expect(renderTemplate('Hi {{1}}, order {{ 2 }} is ready.', ['1', '2'], ['Jamie', 'A-1'])).toBe(
      'Hi Jamie, order A-1 is ready.',
    );
  });

  it('marks as sendable only what Meroidea can fill in', () => {
    const base = { id: '1', name: 'n', language: 'en', status: 'APPROVED', category: 'UTILITY' };
    expect(
      parseTemplate({ ...base, components: [{ type: 'BODY', text: 'Hi {{1}}' }] })?.sendable,
    ).toBe(true);
    expect(
      parseTemplate({
        ...base,
        components: [
          { type: 'HEADER', format: 'IMAGE' },
          { type: 'BODY', text: 'Hi' },
        ],
      })?.sendable,
    ).toBe(false);
    expect(
      parseTemplate({
        ...base,
        components: [
          { type: 'BODY', text: 'Track it' },
          { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://example.com/{{1}}' }] },
        ],
      })?.sendable,
    ).toBe(false);
    expect(
      parseTemplate({
        ...base,
        category: 'AUTHENTICATION',
        components: [{ type: 'BODY', text: 'Code' }],
      })?.sendable,
    ).toBe(false);
  });

  it('checks a new template the way Meta will', () => {
    const valid = {
      accountId: '00000000-0000-4000-8000-000000000000',
      name: 'order_ready',
      category: 'utility',
      language: 'en',
      body: 'Hi {{1}}, order {{2}} is ready.',
      examples: ['Sam', 'A-1'],
    };
    expect(createTemplateSchema.safeParse(valid).success).toBe(true);
    expect(createTemplateSchema.safeParse({ ...valid, name: 'Order Ready' }).success).toBe(false);
    expect(
      createTemplateSchema.safeParse({ ...valid, body: 'Hi {{2}}, order {{1}}.' }).success,
    ).toBe(false);
    expect(
      createTemplateSchema.safeParse({ ...valid, body: '{{1}} your order is ready' }).success,
    ).toBe(false);
    expect(createTemplateSchema.safeParse({ ...valid, examples: ['Sam'] }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ ...valid, headerText: 'Hi {{1}}' }).success).toBe(
      false,
    );
  });

  it('refuses values WhatsApp would refuse', () => {
    const reply = {
      conversationId: '00000000-0000-4000-8000-000000000000',
      templateId: '00000000-0000-4000-8000-000000000001',
    };
    expect(templateReplySchema.safeParse({ ...reply, values: ['Jamie'] }).success).toBe(true);
    expect(templateReplySchema.safeParse({ ...reply, values: ['two\nlines'] }).success).toBe(false);
    expect(templateReplySchema.safeParse({ ...reply, values: ['a      b'] }).success).toBe(false);
  });
});

describe('sending on WhatsApp', () => {
  it('addresses a customer by number, or by their user id when the number is hidden', () => {
    expect(whatsappRecipient('61400111222')).toEqual({ to: '+61400111222' });
    expect(whatsappRecipient('AU.1234567890abcdef')).toEqual({ recipient: 'AU.1234567890abcdef' });
  });

  it('allows free text for 24 hours, then only a template', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    expect(replyWindow('whatsapp', new Date('2026-11-20T00:00:00Z'), now)).toEqual({
      ok: true,
      humanAgent: false,
    });
    const closed = replyWindow('whatsapp', new Date('2026-11-19T11:00:00Z'), now);
    expect(closed.ok).toBe(false);
    expect(!closed.ok && closed.reason).toMatch(/approved template/);
  });

  it('explains WhatsApp’s failures in words, and counts its throttling as rate limits', () => {
    expect(whatsappReason(131047)).toMatch(/approved template/);
    expect(whatsappReason('131042')).toMatch(/payment method/);
    expect(whatsappReason(999999)).toBeNull();
    expect(isRateLimited(400, 130429)).toBe(true);
    expect(isRateLimited(400, 131056)).toBe(true);
  });
});

describe('downloading WhatsApp files', () => {
  it('sends the token to Meta’s file host and never onwards to another host', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://scontent.xx.fbcdn.net/v/file.jpg' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Blob([JPEG]), { headers: { 'content-type': 'image/jpeg' } }),
      );
    await downloadMedia('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', {
      bearer: 'SECRET_TOKEN',
    });
    const headersOf = (index: number) =>
      new Headers((fetchMock.mock.calls[index]?.[1] as RequestInit | undefined)?.headers);
    expect(headersOf(0).get('authorization')).toBe('Bearer SECRET_TOKEN');
    expect(headersOf(1).get('authorization')).toBeNull();
  });

  it('never sends the token to an address outside the media hosts', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(
      downloadMedia('https://evil.example.com/a.jpg', { bearer: 'SECRET_TOKEN' }),
    ).rejects.toBeInstanceOf(MediaRefused);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
