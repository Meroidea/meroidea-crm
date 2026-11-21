'use client';

import { MessageCircle, Plug } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { ErrorNote } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { connectWhatsAppAction } from '@/modules/social/actions';

/*
 * Connecting a WhatsApp number runs through Meta's Embedded Signup, which only works with
 * Meta's JavaScript SDK (ADR-066). The platform owner approved loading it on this page only, and
 * only once an admin asks to connect: the first click loads it, the second opens Meta's window
 * (a popup must open straight from a click, or the browser blocks it).
 */

type FacebookSdk = {
  init: (options: Record<string, unknown>) => void;
  login: (
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: Record<string, unknown>,
  ) => void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';

let sdkPromise: Promise<FacebookSdk> | null = null;

function loadSdk(appId: string, version: string): Promise<FacebookSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    const ready = () => {
      window.FB!.init({ appId, autoLogAppEvents: false, xfbml: false, version });
      resolve(window.FB!);
    };
    if (window.FB) return ready();
    window.fbAsyncInit = ready;
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('blocked'));
    };
    document.body.appendChild(script);
    setTimeout(() => reject(new Error('timeout')), 20_000);
  });
  return sdkPromise;
}

type Session = { wabaId: string; phoneNumberId: string; coexistence: boolean };

/** Meta's window reports the account and number chosen with a message to this page. */
function readSessionMessage(event: MessageEvent): Session | 'cancelled' | string | null {
  if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/.test(event.origin)) return null;
  let data: unknown = event.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const message = data as {
    type?: unknown;
    event?: unknown;
    data?: { waba_id?: unknown; phone_number_id?: unknown; error_message?: unknown };
  };
  if (message?.type !== 'WA_EMBEDDED_SIGNUP') return null;
  if (message.event === 'CANCEL') return 'cancelled';
  if (message.event === 'ERROR') {
    return typeof message.data?.error_message === 'string'
      ? message.data.error_message.slice(0, 200)
      : 'Meta reported an error.';
  }
  const wabaId = message.data?.waba_id;
  const phoneNumberId = message.data?.phone_number_id;
  if (typeof wabaId !== 'string' || typeof phoneNumberId !== 'string') return null;
  return {
    wabaId,
    phoneNumberId,
    coexistence: message.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  };
}

export function WhatsAppConnect({
  appId,
  configId,
  graphVersion,
}: {
  appId: string;
  configId: string;
  graphVersion: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<'app' | 'new'>('app');
  const [sdk, setSdk] = useState<FacebookSdk | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'waiting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const session = useRef<Session | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const result = readSessionMessage(event);
      if (result === null) return;
      if (result === 'cancelled') {
        setPhase('ready');
        setError('Connecting was cancelled before a number was shared.');
      } else if (typeof result === 'string') {
        setPhase('ready');
        setError(result);
      } else {
        session.current = result;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const prepare = () => {
    setError(null);
    setPhase('loading');
    loadSdk(appId, graphVersion)
      .then((loaded) => {
        setSdk(loaded);
        setPhase('ready');
      })
      .catch(() => {
        setPhase('idle');
        setError(
          'Meta’s sign-up could not load. Check that nothing in this browser blocks facebook.net, then try again.',
        );
      });
  };

  const finish = (code: string) => {
    // The message with the chosen number can arrive just after the code: wait a moment for it.
    let waited = 0;
    const attempt = () => {
      const chosen = session.current;
      if (!chosen && waited < 5_000) {
        waited += 250;
        setTimeout(attempt, 250);
        return;
      }
      if (!chosen) {
        setPhase('ready');
        setError('Meta did not say which number was chosen. Please try again.');
        return;
      }
      startTransition(async () => {
        const result = await connectWhatsAppAction({ code, ...chosen });
        setPhase('ready');
        session.current = null;
        if (!result.ok) return setError(result.error.message);
        setNotice(
          result.data.warning ??
            (chosen.coexistence
              ? 'Connected. Your WhatsApp Business app chats are being imported; this can take a while.'
              : 'Connected. New WhatsApp messages now arrive in the inbox.'),
        );
        router.refresh();
      });
    };
    attempt();
  };

  const open = () => {
    if (!sdk) return;
    setError(null);
    setNotice(null);
    session.current = null;
    setPhase('waiting');
    sdk.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setPhase('ready');
          return;
        }
        finish(code);
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          sessionInfoVersion: '3',
          ...(kind === 'app' ? { featureType: 'whatsapp_business_app_onboarding' } : {}),
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Which number?</legend>
        <Label className="flex items-start gap-2 font-normal">
          <input
            type="radio"
            name="whatsapp-kind"
            className="mt-0.5"
            checked={kind === 'app'}
            onChange={() => setKind('app')}
          />
          <span>
            The number on our WhatsApp Business app
            <span className="block text-xs text-muted-foreground">
              Keep using the app on your phone. Its chats from the last 6 months are imported.
            </span>
          </span>
        </Label>
        <Label className="flex items-start gap-2 font-normal">
          <input
            type="radio"
            name="whatsapp-kind"
            className="mt-0.5"
            checked={kind === 'new'}
            onChange={() => setKind('new')}
          />
          <span>
            A number not yet on WhatsApp
            <span className="block text-xs text-muted-foreground">
              It will be used through Meroidea only, not in a WhatsApp app.
            </span>
          </span>
        </Label>
      </fieldset>
      {phase === 'idle' || phase === 'loading' ? (
        <Button onClick={prepare} disabled={phase === 'loading'}>
          <Plug aria-hidden />{' '}
          {phase === 'loading' ? 'Preparing Meta’s sign-up…' : 'Connect WhatsApp'}
        </Button>
      ) : (
        <Button onClick={open} disabled={phase === 'waiting' || isPending}>
          <MessageCircle aria-hidden />{' '}
          {isPending
            ? 'Connecting…'
            : phase === 'waiting'
              ? 'Finish in Meta’s window…'
              : 'Continue with Facebook'}
        </Button>
      )}
      {notice && (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
