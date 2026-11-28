import type { Metadata } from 'next';

import { MeroAIInboxScreen } from '../../social/meroai-screen';

export const metadata: Metadata = { title: 'Ask MeroAI' };

export default async function MeroAIEmailPage({ searchParams }: PageProps<'/email/meroai'>) {
  return <MeroAIInboxScreen query={await searchParams} />;
}
