import { ConversationScreen, conversationMetadata } from '../conversation-screen';

export const metadata = conversationMetadata;

export default async function SocialConversationPage({
  params,
  searchParams,
}: PageProps<'/social/[id]'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <ConversationScreen id={id} query={query} mailbox="social" />;
}
