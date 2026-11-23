import { ConversationScreen, conversationMetadata } from '../../social/conversation-screen';

export const metadata = conversationMetadata;

export default async function EmailThreadPage({ params, searchParams }: PageProps<'/email/[id]'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <ConversationScreen id={id} query={query} mailbox="email" />;
}
