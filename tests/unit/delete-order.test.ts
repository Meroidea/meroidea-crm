import { describe, expect, it } from 'vitest';

import { deletionOrder } from '@/modules/platform/delete-order';

describe('deletionOrder', () => {
  it('empties every table before the tables it references', () => {
    const order = deletionOrder(
      ['employees', 'payslips', 'contracts', 'roles'],
      [
        ['payslips', 'employees'],
        ['contracts', 'employees'],
        ['employees', 'roles'],
      ],
    );
    const at = (table: string) => order.indexOf(table);
    expect(order).toHaveLength(4);
    expect(at('payslips')).toBeLessThan(at('employees'));
    expect(at('contracts')).toBeLessThan(at('employees'));
    expect(at('employees')).toBeLessThan(at('roles'));
  });

  it('ignores references to tables outside the business and to the table itself', () => {
    expect(
      deletionOrder(
        ['contacts'],
        [
          ['contacts', 'contacts'],
          ['contacts', 'users'],
          ['website_enquiries', 'contacts'],
        ],
      ),
    ).toEqual(['contacts']);
  });

  it('refuses, before anything is deleted, when tables reference each other in a cycle', () => {
    expect(() =>
      deletionOrder(
        ['a', 'b'],
        [
          ['a', 'b'],
          ['b', 'a'],
        ],
      ),
    ).toThrow(/cycle/);
  });
});
