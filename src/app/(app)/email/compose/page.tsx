import type { Metadata } from 'next';

import { ComposeScreen } from '../../social/compose-screen';

export const metadata: Metadata = { title: 'New email' };

export default async function ComposePage({ searchParams }: PageProps<'/email/compose'>) {
  return <ComposeScreen query={await searchParams} />;
}
