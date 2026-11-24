'use client';

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';

import { MeroOrb } from '@/components/motion/mero-orb';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { getConversation, subscribeConversation } from './roster-agent-store';

type AgentState = { open: boolean; setOpen: (open: boolean) => void };

const AgentContext = createContext<AgentState | null>(null);

/** Open state of the roster agent panel, for the toolbar button and the panel's own close. */
export function useRosterAgent(): AgentState | null {
  return useContext(AgentContext);
}

/**
 * The roster with the agent docked beside it (ADR-079): side by side on a wide screen, over the
 * roster on a narrow one. The panel is mounted once and only its placement changes, so the
 * conversation survives resizing. It opens by itself when this period has a conversation kept.
 */
export function RosterAgentLayout({
  storageKey,
  panel,
  children,
}: {
  storageKey: string;
  panel: ReactNode;
  children: ReactNode;
}) {
  const hasConversation = useSyncExternalStore(
    subscribeConversation,
    () => getConversation(storageKey).length > 0,
    () => false,
  );
  // Until the manager opens or closes it, the panel is open exactly when there is a conversation.
  const [chosen, setOpen] = useState<boolean | null>(null);
  const open = chosen ?? hasConversation;

  return (
    <AgentContext.Provider value={{ open, setOpen }}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">{children}</div>
        <aside
          aria-hidden={!open}
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-background lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:h-[calc(100dvh-6rem)] lg:w-[24rem] lg:shrink-0 lg:overflow-hidden lg:rounded-xl lg:border lg:shadow-sm xl:w-[26rem]',
            !open && 'hidden',
          )}
        >
          {panel}
        </aside>
      </div>
    </AgentContext.Provider>
  );
}

/** "Roster agent" in the roster's toolbar. */
export function RosterAgentButton() {
  const agent = useRosterAgent();
  if (!agent) return null;
  return (
    <Button
      variant="outline"
      aria-pressed={agent.open}
      onClick={() => agent.setOpen(!agent.open)}
      className="gap-1.5"
    >
      <MeroOrb size={20} state="idle" className="-my-1" />
      Roster agent
    </Button>
  );
}
