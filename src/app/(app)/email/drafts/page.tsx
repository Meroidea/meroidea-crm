import type { Metadata } from 'next';

import { DraftsScreen } from '../../social/drafts-screen';

export const metadata: Metadata = { title: 'Drafts' };

export default function DraftsPage() {
  return <DraftsScreen />;
}
