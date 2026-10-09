/** Worked minutes after the break; zero while the person is still clocked in. */
export function workedMinutes(entry: {
  clockIn: Date;
  clockOut: Date | null;
  breakMinutes: number;
}): number {
  if (!entry.clockOut) return 0;
  const total = Math.round((entry.clockOut.getTime() - entry.clockIn.getTime()) / 60_000);
  return Math.max(0, total - entry.breakMinutes);
}
