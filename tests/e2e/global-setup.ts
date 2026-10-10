import { ensurePlatformOwner } from './support/accounts';

export default async function globalSetup(): Promise<void> {
  await ensurePlatformOwner();
}
