/** The leave types a new business starts with; they rename or add their own. */
export const DEFAULT_LEAVE_TYPES = [
  { name: 'Annual leave', isPaid: true },
  { name: 'Sick leave', isPaid: true },
  { name: 'Unpaid leave', isPaid: false },
] as const;
