/**
 * Whoever signs off hours, leave or expenses that set someone's pay must be someone else: a
 * manager cannot approve their own. The Admin, who answers to no one in the business, may.
 */
export function maySignOffFor(
  ctx: { userId: string; roleKey: string | null },
  personId: string,
): boolean {
  return personId !== ctx.userId || ctx.roleKey === 'owner';
}
