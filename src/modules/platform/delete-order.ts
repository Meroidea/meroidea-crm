/**
 * The order to empty a business's tables in: every table before the tables it references, so no
 * foreign key is ever left pointing at a deleted row. Worked out from the database's own foreign
 * keys each time (ADR-056), so a table added later is never missed or deleted out of order.
 */
export function deletionOrder(tables: string[], references: [child: string, parent: string][]) {
  const known = new Set(tables);
  // How many other tables still point at each table; a table can go once nothing does.
  const pointedAtBy = new Map(tables.map((table) => [table, new Set<string>()]));
  for (const [child, parent] of references) {
    if (child === parent || !known.has(child) || !known.has(parent)) continue;
    pointedAtBy.get(parent)?.add(child);
  }
  const order: string[] = [];
  const left = new Set(tables);
  while (left.size > 0) {
    const ready = [...left].filter((table) =>
      [...(pointedAtBy.get(table) ?? [])].every((child) => !left.has(child)),
    );
    if (ready.length === 0) {
      throw new Error(`Tables reference each other in a cycle: ${[...left].sort().join(', ')}`);
    }
    for (const table of ready.sort()) {
      order.push(table);
      left.delete(table);
    }
  }
  return order;
}
