import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AccountForm } from '@/modules/books/components/books-tools';
import { BooksNav } from '@/modules/books/components/books-nav';
import { formatAmount } from '@/modules/books/labels';
import { ACCOUNT_TYPES, SUBTYPE_LABELS } from '@/modules/books/packs';
import { getBooksSettings, listAccounts, listTaxCodes } from '@/modules/books/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Chart of accounts' };

export default async function AccountsPage({ searchParams }: PageProps<'/books/accounts'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  if (!(await getBooksSettings(ctx))) redirect('/books');
  const showArchived = (await searchParams).archived === '1';
  const [accounts, taxCodes] = await Promise.all([
    listAccounts(ctx, { includeArchived: showArchived }),
    listTaxCodes(ctx),
  ]);
  const canManage = hasPermission(ctx, 'books.manage');

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Chart of accounts"
        description="Every account, its balance today, and its usual tax code."
        actions={
          <Link
            href={showArchived ? '/books/accounts' : '/books/accounts?archived=1'}
            className="text-sm underline-offset-4 hover:underline"
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Link>
        }
      />
      <BooksNav current="/books/accounts" />
      {ACCOUNT_TYPES.map((group) => {
        const rows = accounts.filter((account) => account.type === group.type);
        if (rows.length === 0) return null;
        return (
          <Card key={group.type}>
            <CardContent>
              <h2 className="mb-2 font-medium">
                {group.label === 'Equity' ? 'Equity' : `${group.label}s`}
              </h2>
              <ul className="divide-y">
                {rows.map((account) => (
                  <li key={account.id}>
                    <Link
                      href={`/books/accounts/${account.id}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 hover:bg-muted/50"
                    >
                      <span className="w-16 text-sm text-muted-foreground tabular-nums">
                        {account.code}
                      </span>
                      <span className="min-w-0 flex-1 basis-48 truncate">{account.name}</span>
                      <span className="hidden text-sm text-muted-foreground sm:inline">
                        {SUBTYPE_LABELS[account.subtype]}
                      </span>
                      {account.systemKey && <Badge variant="outline">Needed by the books</Badge>}
                      {account.archived && <Badge variant="destructive">Archived</Badge>}
                      <span className="w-28 text-right tabular-nums">
                        {formatAmount(account.balance, ctx.tenant.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
      {canManage && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="font-medium">Add an account</h2>
            <AccountForm
              taxCodes={taxCodes.map(({ id, code, name, rate, appliesTo }) => ({
                id,
                code,
                name,
                rate,
                appliesTo,
              }))}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
