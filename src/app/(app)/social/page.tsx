import type { Metadata } from 'next';

import { InboxScreen } from './inbox-screen';

export const metadata: Metadata = { title: 'Social inbox' };

export default async function SocialInboxPage({ searchParams }: PageProps<'/social'>) {
  return <InboxScreen query={await searchParams} mailbox="social" />;
}
