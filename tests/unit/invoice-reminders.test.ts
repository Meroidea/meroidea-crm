import { describe, expect, it } from 'vitest';

import { toneFor, writeReminder } from '@/modules/ai/invoice-reminders';

// Payment reminders (ADR-077): written by code from the invoice's own figures.

const base = {
  invoiceId: 'inv-1',
  reference: 'INV-0042',
  customerName: 'Olivia Example',
  customerEmail: 'olivia@example.com',
  balance: '1250.5',
  currency: 'AUD',
  dueDate: '2026-11-01',
  businessName: 'Harbour Cafe',
  senderName: 'Hana Owner',
};

describe('payment reminders', () => {
  it('steps up the tone with how late the invoice is', () => {
    expect(toneFor(1)).toBe('friendly');
    expect(toneFor(13)).toBe('friendly');
    expect(toneFor(14)).toBe('firm');
    expect(toneFor(44)).toBe('firm');
    expect(toneFor(45)).toBe('final');
  });

  it('a friendly reminder carries the exact amount, reference and due date, and signs off', () => {
    const reminder = writeReminder({ ...base, today: '2026-11-06' });
    expect(reminder).toMatchObject({ tone: 'friendly', daysOverdue: 5 });
    expect(reminder.subject).toBe('Friendly reminder: invoice INV-0042 for $1,250.50');
    expect(reminder.body).toContain('Hello Olivia,');
    expect(reminder.body).toContain('was due on 1 Nov 2026');
    expect(reminder.body).toContain('Hana Owner\nHarbour Cafe');
  });

  it('a final notice says how late it is and asks for payment within 7 days', () => {
    const reminder = writeReminder({ ...base, today: '2027-01-05' });
    expect(reminder.tone).toBe('final');
    expect(reminder.subject).toBe(
      'Final notice: invoice INV-0042 for $1,250.50 is 65 days overdue',
    );
    expect(reminder.body).toContain('within 7 days');
  });

  it('greets a business by its whole name', () => {
    const reminder = writeReminder({
      ...base,
      customerName: 'Acme Freight Pty Ltd',
      today: '2026-11-20',
    });
    expect(reminder.tone).toBe('firm');
    expect(reminder.body).toContain('Hello Acme Freight Pty Ltd,');
  });
});
