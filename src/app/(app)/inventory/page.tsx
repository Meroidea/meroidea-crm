import { Boxes, CircleDollarSign, PackageX, TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { FilterBar } from '@/components/data/filter-bar';
import { PageHeader } from '@/components/data/page-header';
import { StatusCountBar } from '@/components/data/status-count-bar';
import { withParams } from '@/components/data/url';
import { Card, CardContent } from '@/components/ui/card';
import { formatMoney } from '@/lib/format';
import { AddItemButton, UpdateStockButton } from '@/modules/inventory/components/inventory-tools';
import { LevelBadge } from '@/modules/inventory/components/stock-level';
import { formatQuantity } from '@/modules/inventory/format';
import { getInventorySummary, listCategories, listItems } from '@/modules/inventory/queries';
import { inventoryFiltersSchema } from '@/modules/inventory/schemas';
import type { InventoryItemRow } from '@/modules/inventory/types';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Inventory' };

export default async function InventoryPage({ searchParams }: PageProps<'/inventory'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'inventory.view');
  const canManage = hasPermission(ctx, 'inventory.manage');
  const filters = inventoryFiltersSchema.parse(await searchParams);
  const [items, summary, categories] = await Promise.all([
    listItems(ctx, filters),
    getInventorySummary(ctx),
    listCategories(ctx),
  ]);

  const view = filters.view ?? 'all';
  const current = { q: filters.q, category: filters.category, view: filters.view };
  const counts = (
    [
      ['all', 'All items', summary.items, 'primary'],
      ['low', 'Low', summary.low, 'chart-3'],
      ['out', 'Out of stock', summary.out, 'destructive'],
      ['archived', 'Archived', summary.archived, 'muted'],
    ] as const
  ).map(([key, label, count, tone]) => ({
    key,
    label,
    count,
    tone,
    active: view === key,
    href: withParams('/inventory', current, { view: key === 'all' ? undefined : key }),
  }));

  const groups = new Map<string, InventoryItemRow[]>();
  for (const item of items) {
    const name = item.categoryName ?? 'Uncategorised';
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }

  const tiles = [
    { icon: Boxes, label: 'Items tracked', value: String(summary.items) },
    { icon: TriangleAlert, label: 'Running low', value: String(summary.low) },
    { icon: PackageX, label: 'Out of stock', value: String(summary.out) },
    {
      icon: CircleDollarSign,
      label: 'Stock value',
      value: formatMoney(summary.stockValue, ctx.tenant.currency),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Inventory"
        description="What you have on hand, what is running low, and every change that got it there."
        actions={
          canManage && (
            <AddItemButton
              categories={categories.map((category) => category.name)}
              currency={ctx.tenant.currency}
            />
          )
        }
      />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon aria-hidden className="size-3.5" /> {label}
            </dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <StatusCountBar label="Items by stock level" items={counts} />
      <FilterBar
        filters={current}
        searchLabel="Search items"
        selects={[
          {
            name: 'category',
            label: 'Category',
            allLabel: 'All categories',
            options: categories.map((category) => ({ value: category.id, label: category.name })),
          },
        ]}
      />

      {items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Boxes}
              title={
                summary.items + summary.archived === 0 ? 'Nothing tracked yet' : 'Nothing matches'
              }
              description={
                summary.items + summary.archived === 0
                  ? 'Add the things you keep in stock, with how many you have today.'
                  : 'Try a different search, category or stock level.'
              }
            />
          </CardContent>
        </Card>
      ) : (
        [...groups].map(([category, rows]) => (
          <section
            key={category}
            aria-label={category}
            className="overflow-hidden rounded-xl border bg-card"
          >
            <header className="flex items-center gap-2.5 border-b bg-muted/40 px-4 py-2.5">
              <h2 className="text-sm font-medium">{category}</h2>
              <span className="text-sm text-muted-foreground tabular-nums">{rows.length}</span>
            </header>
            <ul className="divide-y">
              {rows.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <Link
                    href={`/inventory/${item.id}`}
                    className="group min-w-0 flex-1 basis-48 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <span className="block truncate font-medium underline-offset-4 group-hover:underline">
                      {item.name}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {item.sku ?? 'No code'}
                      {item.stockValue &&
                        ` · ${formatMoney(item.stockValue, item.currency)} on hand`}
                    </span>
                  </Link>
                  <span className="text-right">
                    <span className="block font-semibold tabular-nums">
                      {formatQuantity(item.quantityOnHand)}{' '}
                      <span className="font-normal text-muted-foreground">{item.unit}</span>
                    </span>
                    {item.reorderLevel && (
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        reorder at {formatQuantity(item.reorderLevel)}
                      </span>
                    )}
                  </span>
                  <LevelBadge level={item.level} />
                  {canManage && item.isActive && <UpdateStockButton item={item} compact />}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
