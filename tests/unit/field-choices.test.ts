import { describe, expect, it } from 'vitest';

import { reconcileChoices } from '@/modules/custom-fields/validation';

const before = [
  { value: 'march', label: 'March' },
  { value: 'july', label: 'July' },
];

describe('editing a picklist', () => {
  it('keeps the stored value when an option is renamed, so records holding it stay valid', () => {
    expect(reconcileChoices(['March intake', 'July'], before)).toEqual([
      { value: 'march', label: 'March intake' },
      { value: 'july', label: 'July' },
    ]);
  });

  it('keeps an option taken off the list as retired, and never reuses its value', () => {
    const next = reconcileChoices(['July', 'March 2'], before);
    expect(next).toContainEqual({ value: 'july', label: 'July' });
    expect(next).toContainEqual({ value: 'march', label: 'March 2' });
    const removed = reconcileChoices(['July'], before);
    expect(removed).toContainEqual({ value: 'march', label: 'March', retired: true });
    const added = reconcileChoices(['July', 'March'], removed);
    expect(added).toContainEqual({ value: 'march', label: 'March' });
  });

  it('gives a new option a value no existing option has', () => {
    const next = reconcileChoices(['March', 'July', 'march!'], before);
    expect(next.map((choice) => choice.value)).toEqual(['march', 'july', 'march_2']);
  });
});
