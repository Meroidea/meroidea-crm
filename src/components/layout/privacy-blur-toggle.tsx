'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const STORAGE_KEY = 'meroidea:privacy-blur';
const CHANGE_EVENT = 'meroidea:privacy-change';

// The <html data-privacy> attribute is the single source of truth: CSS reads it to blur, and
// this component subscribes to it, so every toggle on the page stays in step.
function isOn(): boolean {
  return document.documentElement.dataset.privacy === 'on';
}

function setBlur(on: boolean) {
  document.documentElement.dataset.privacy = on ? 'on' : 'off';
  try {
    window.sessionStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage can be blocked (private mode); the toggle still works for this page.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/**
 * Screen-share mode: blurs personal details (anything marked data-sensitive) while a consultant
 * shares their screen with a client. A display aid only — access control stays on the server.
 * Shift+P toggles it; the choice lasts for this browser tab's session.
 */
export function PrivacyBlurToggle() {
  const on = useSyncExternalStore(subscribe, isOn, () => false);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(STORAGE_KEY) === 'on') setBlur(true);
    } catch {
      // No storage: start with blur off.
    }

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.shiftKey && !event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'p') {
        setBlur(!isOn());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const label = on ? 'Show personal details' : 'Hide personal details (screen sharing)';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={on ? 'secondary' : 'ghost'}
          size="icon"
          aria-label={label}
          aria-pressed={on}
          onClick={() => setBlur(!on)}
        >
          {on ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} <kbd className="ml-1 rounded border px-1 text-[10px]">⇧P</kbd>
      </TooltipContent>
    </Tooltip>
  );
}
