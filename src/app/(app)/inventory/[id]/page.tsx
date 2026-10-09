import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { formatDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  ArchiveItemButton,
  EditItemButton,
  UpdateStockButton,
} from '@/modules/inventory/components/inventory-tools';
import { LevelBadge, LevelGauge } from '@/modules/inventory/components/stock-level';
import { formatDelta, formatQuantity, MOVEMENT_TYPE_LABELS } from '@/modules/inventory/format';
import { getItem, listCategories, listMovements } from '@/modules/inventory/queries';
import { itemIdSchema } from '@/modules/inventory/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Inventory item' };

export default async function InventoryItemPage({ params }: PageProps<'/inventory/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'inventory.view');
  const parsed = itemIdSchema.safeParse(await params);
  const item = parsed.success ? await getItem(ctx, parsed.data.id) : null;
  if (!item) notFound();
  const canManage = hasPermission(ctx, 'inventory.manage');
  const [movements, categories] = await Promise.all([
    listMovements(ctx, item.id),
    listCategories(ctx),
  ]);

  const facts: [string, string][] = [
    ['Category', item.categoryName ?? 'Uncategorised'],
    ['Code', item.sku ?? '—'],
    ['Cost per unit', item.unitCost ? formatMoney(item.unitCost, item.currency) : '—'],
    ['Value on hand', item.stockValue ? formatMoney(item.stockValue, item.currency) : '—'],
    ['Supplier', item.supplierName ?? '—'],
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div>
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/inventory" className="underline-offset-4 hover:underline">
            Inventory
          </Link>{' '}
          / {item.name}
        </nav>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
            <LevelBadge level={item.level} />
            {!item.isActive && <Badge variant="outline">Archived</Badge>}
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <ArchiveItemButton id={item.id} isActive={item.isActive} />
              <EditItemButton
                item={item}
                categories={categories.map((category) => category.name)}
              />
              {item.isActive && <UpdateStockButton item={item} />}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <section className="rounded-xl border bg-card p-5">
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            On hand
          </p>
          <p className="mt-2">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">
              {formatQuantity(item.quantityOnHand)}
            </span>{' '}
            <span className="text-muted-foreground">{item.unit}</span>
          </p>
          <div className="mt-4">
            <LevelGauge
              quantityOnHand={item.quantityOnHand}
              reorderLevel={item.reorderLevel}
              level={item.level}
              unit={item.unit}
            />
            {!item.reorderLevel && (
              <p className="text-xs text-muted-foreground">
                No reorder level set, so this item is never flagged as low.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b py-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {item.notes && <p className="mt-4 text-sm text-muted-foreground">{item.notes}</p>}
        </section>
      </div>

      <section aria-label="Stock history" className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b bg-muted/40 px-4 py-2.5">
          <h2 className="text-sm font-medium">History</h2>
        </header>
        {movements.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No stock has been recorded for this item yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="px-4 py-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    What
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Change
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Balance
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    By
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      {formatDateTime(ctx, movement.occurredAt)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {MOVEMENT_TYPE_LABELS[movement.type]}
                      {movement.unitCost && (
                        <span className="text-muted-foreground">
                          {' '}
                          at {formatMoney(movement.unitCost, item.currency)}
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2.5 text-right font-medium tabular-nums',
                        movement.quantityDelta.startsWith('-') && 'text-destructive-text',
                      )}
                    >
                      {formatDelta(movement.quantityDelta)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatQuantity(movement.quantityAfter)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap" data-sensitive>
                      {movement.byName ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{movement.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
