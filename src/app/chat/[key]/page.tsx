import type { Metadata } from 'next';

import { ChatWindow } from '@/modules/social/components/chat-window';
import { findChatWidget } from '@/modules/social/livechat-widget';

export const metadata: Metadata = {
  title: 'Chat',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * A live chat widget's page (ADR-072): framed by the business's site through /widget/v1.js, or
 * opened on its own. Who may frame it is set per widget in proxy.ts.
 */
export default async function ChatPage({ params, searchParams }: PageProps<'/chat/[key]'>) {
  const [{ key }, query] = await Promise.all([params, searchParams]);
  const widget = await findChatWidget(key);
  if (!widget) {
    return (
      <main className="flex h-svh items-center justify-center bg-background p-6 text-center">
        <div className="flex max-w-sm flex-col gap-2">
          <h1 className="text-lg font-semibold">This chat is not available</h1>
          <p className="text-sm text-muted-foreground">
            It may have been switched off. Contact the business another way.
          </p>
        </div>
      </main>
    );
  }
  return (
    <ChatWindow
      widgetKey={key}
      name={widget.name}
      greeting={widget.greeting}
      requireEmail={widget.requireEmail}
      embedded={query.embed === '1'}
    />
  );
}
