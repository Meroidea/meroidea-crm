import { Bell } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Card } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { NotificationList } from '@/modules/notifications/components/notification-list';
import { listNotifications } from '@/modules/notifications/queries';
import { requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const ctx = await requireTenantContext();
  const items = await listNotifications(ctx);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader
        title="Notifications"
        description="Leads assigned to you, handovers to answer, approvals and overdue work."
      />
      <Card className="gap-0 overflow-hidden py-0">
        {items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="You’re all caught up"
            description="New notices show up here."
          />
        ) : (
          <NotificationList
            items={items.map((item) => ({
              id: item.id,
              title: item.title,
              body: item.body,
              url: item.url,
              unread: item.readAt === null,
              when: formatDateTime(ctx, item.createdAt),
            }))}
          />
        )}
      </Card>
    </div>
  );
}
