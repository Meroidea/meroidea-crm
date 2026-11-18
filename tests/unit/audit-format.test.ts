import { describe, expect, it } from 'vitest';

import { fieldWords } from '@/lib/audit-diff';
import { DEFAULT_LABELS } from '@/lib/tenant/labels';
import {
  actionLabel,
  actorLabel,
  changeLines,
  detailLines,
  entityLabel,
  recordHref,
  valueText,
} from '@/modules/audit/format';
import { auditFiltersSchema } from '@/modules/audit/schemas';

describe('audit log wording', () => {
  it('names actions, and falls back to the stored word for ones it does not know', () => {
    expect(actionLabel('stage_change')).toBe('Moved stage');
    expect(actionLabel('business_paused')).toBe('Business paused');
  });

  it('uses the business’s own words for records it can rename', () => {
    const labels = {
      ...DEFAULT_LABELS,
      contact: { singular: 'Guest', plural: 'Guests' },
      opportunityItem: { singular: 'Booking', plural: 'Bookings' },
    };
    expect(entityLabel('contact', labels)).toBe('Guest');
    expect(entityLabel('opportunity_item', labels)).toBe('Booking');
    expect(entityLabel('employee_payroll_details', labels)).toBe('Tax, bank and super details');
    expect(entityLabel('stage_approval', labels)).toBe('Stage approval');
  });

  it('says what wrote an entry when no person did', () => {
    expect(actorLabel({ actorType: 'user', actorName: 'Ana', actorUserId: 'u1' })).toBe('Ana');
    expect(actorLabel({ actorType: 'platform', actorName: 'Ola', actorUserId: 'u2' })).toBe(
      'Ola (platform owner)',
    );
    expect(actorLabel({ actorType: 'platform', actorName: null, actorUserId: null })).toBe(
      'Platform owner',
    );
    expect(actorLabel({ actorType: 'system', actorName: null, actorUserId: null })).toBe(
      'Meroidea (automatic)',
    );
    expect(actorLabel({ actorType: 'user', actorName: null, actorUserId: 'u3' })).toBe(
      'Unknown person',
    );
  });
});

describe('audit log values', () => {
  it('shows each changed field as before and after, keeping masked values masked', () => {
    expect(
      changeLines({
        phoneE164: ['+61400000001', '+61400000002'],
        dateOfBirth: ['•••', '•••'],
        status: 'sent',
      }),
    ).toEqual([
      { field: 'phone', before: '+61400000001', after: '+61400000002' },
      { field: 'date of birth', before: '•••', after: '•••' },
      { field: 'status', before: '—', after: 'sent' },
    ]);
    expect(changeLines(null)).toEqual([]);
    expect(changeLines(['not', 'a', 'diff'])).toEqual([]);
  });

  it('cuts long values short and writes objects as JSON', () => {
    expect(valueText('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(valueText({ a: 1 })).toBe('{"a":1}');
    expect(valueText(false)).toBe('false');
    expect(valueText('')).toBe('—');
  });

  it('lists details in words', () => {
    expect(detailLines({ mergedInto: 'abc', rows: 3 })).toEqual([
      { label: 'Merged into', value: 'abc' },
      { label: 'Rows', value: '3' },
    ]);
    expect(fieldWords('companyWebsite')).toBe('company website');
  });

  it('links to a record’s page only where one exists', () => {
    expect(recordHref('contact', 'id-1')).toBe('/contacts/id-1');
    expect(recordHref('employee', 'id-2')).toBe('/staff/id-2');
    expect(recordHref('tenant', 'id-3')).toBeNull();
    expect(recordHref('contact', null)).toBeNull();
  });
});

describe('audit log filters', () => {
  it('drop anything that is not an id, a date or a known choice', () => {
    expect(
      auditFiltersSchema.parse({
        from: '2026-03-01',
        to: 'yesterday',
        person: 'ana@example.com',
        action: 'update',
        type: 'Contact; drop table',
        record: '7d9f5c62-1f4e-4c55-9d7c-2b9f0c6d1a11',
      }),
    ).toEqual({
      from: '2026-03-01',
      action: 'update',
      record: '7d9f5c62-1f4e-4c55-9d7c-2b9f0c6d1a11',
    });
  });
});
