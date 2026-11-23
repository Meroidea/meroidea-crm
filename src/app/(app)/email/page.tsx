import type { Metadata } from 'next';

import { InboxScreen } from '../social/inbox-screen';

export const metadata: Metadata = { title: 'Email' };

export default async function EmailPage({ searchParams }: PageProps<'/email'>) {
  return <InboxScreen query={await searchParams} mailbox="email" />;
}
