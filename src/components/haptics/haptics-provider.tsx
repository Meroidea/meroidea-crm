'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  DEFAULT_HAPTIC_PREFS,
  getHapticCapabilities,
  getHapticPrefs,
  haptics,
  isHapticPattern,
  popElement,
  setHapticPrefs,
  subscribeHapticPrefs,
  triggerHaptic,
  type HapticCapabilities,
  type HapticPattern,
  type HapticPrefs,
} from '@/lib/haptics';
import { installIosTapBridge, isIosOverlay } from '@/lib/haptics-ios';

type HapticsValue = {
  prefs: HapticPrefs;
  setPrefs: (patch: Partial<HapticPrefs>) => void;
  /** Null while rendering on the server and during hydration. */
  capabilities: HapticCapabilities | null;
  trigger: typeof triggerHaptic;
  haptics: typeof haptics;
  popElement: typeof popElement;
};

const HapticsContext = createContext<HapticsValue | null>(null);

const noSubscribe = () => () => {};

function usePrefs(): HapticPrefs {
  return useSyncExternalStore(subscribeHapticPrefs, getHapticPrefs, () => DEFAULT_HAPTIC_PREFS);
}

function useCapabilities(): HapticCapabilities | null {
  return useSyncExternalStore(noSubscribe, getHapticCapabilities, () => null);
}

/**
 * Controls that answer a press. One listener for the whole document covers every button,
 * switch, checkbox and menu item, raw or from `src/components/ui`, without wiring each one.
 * `data-haptic="<pattern>|off"` on an element (or an ancestor; the nearest wins) overrides it.
 */
const PRESSABLE = [
  '[data-haptic]',
  'button',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'label:has(input[type="checkbox"], input[type="radio"])',
  // Navigation links (site header and footer, the phone menu, the sidebar). Links in running
  // text stay quiet: the page that arrives gives its own soft pulse.
  'nav a[href]',
  '[role="navigation"] a[href]',
].join(',');

type Press = { control: Element; pattern: HapticPattern };

function pressFor(target: EventTarget | null): Press | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest(PRESSABLE);
  if (!control || control.closest('[data-haptic-driver]')) return null;
  if (
    control.matches(':disabled') ||
    control.closest('[aria-disabled="true"], [data-disabled]') !== null
  ) {
    return null;
  }
  const override = control.closest('[data-haptic]')?.getAttribute('data-haptic');
  if (override === 'off') return null;
  return { control, pattern: isHapticPattern(override) ? override : 'tap' };
}

/**
 * Tactile feedback for the whole app (ADR-073). Holds the person's preferences, answers presses,
 * and gives a soft pulse when a new page arrives. Mounted once, in the root layout.
 */
export function HapticsProvider({ children }: { children: ReactNode }) {
  const prefs = usePrefs();
  const capabilities = useCapabilities();
  const pathname = usePathname();
  const shownPath = useRef(pathname);

  useEffect(() => {
    // On iPhones the tick comes from the tapped control's own label (haptics-ios.ts), so the
    // click only adds sound and spring; everywhere else `pointerdown` answers before the finger
    // lifts, so the press feels immediate.
    const onIos = getHapticCapabilities().iosSwitch;
    const onPointerDown = (event: PointerEvent) => {
      if (onIos || event.button !== 0) return;
      const press = pressFor(event.target);
      if (press) triggerHaptic(press.pattern);
    };
    const onClick = (event: MouseEvent) => {
      // detail 0: a click made with the keyboard, which has nothing to feel.
      if (!onIos || !event.isTrusted || event.detail === 0) return;
      const press = pressFor(event.target);
      if (press) triggerHaptic(press.pattern, { device: !isIosOverlay(event.target) });
    };
    const options = { capture: true, passive: true } as const;
    document.addEventListener('pointerdown', onPointerDown, options);
    document.addEventListener('click', onClick, options);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, options);
      document.removeEventListener('click', onClick, options);
    };
  }, []);

  // iPhones: lay a label over each control so a real tap ticks (iOS 26.5+). Only while feedback
  // is on, since an armed control ticks whatever the app's own setting says.
  const hapticsOn = prefs.hapticsEnabled;
  useEffect(() => {
    if (!hapticsOn || !getHapticCapabilities().iosSwitch) return;
    return installIosTapBridge((target) => pressFor(target)?.control ?? null);
  }, [hapticsOn]);

  // Compared with the page last shown rather than "skip the first run", which Strict Mode's
  // second effect pass would defeat.
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    triggerHaptic('soft');
  }, [pathname]);

  const value = useMemo<HapticsValue>(
    () => ({
      prefs,
      setPrefs: setHapticPrefs,
      capabilities,
      trigger: triggerHaptic,
      haptics,
      popElement,
    }),
    [prefs, capabilities],
  );

  return <HapticsContext.Provider value={value}>{children}</HapticsContext.Provider>;
}

/** Preferences and triggers. Works outside the provider too, reading the engine directly. */
export function useHaptics(): HapticsValue {
  const context = useContext(HapticsContext);
  const prefs = usePrefs();
  const capabilities = useCapabilities();
  return (
    context ?? {
      prefs,
      setPrefs: setHapticPrefs,
      capabilities,
      trigger: triggerHaptic,
      haptics,
      popElement,
    }
  );
}

/**
 * Plays `cardAppear` when `count` grows after the first render: a new notification, message or
 * card arriving. Never on page load, and the engine folds a burst into one pulse. A change of
 * `resetKey` (another conversation, say) starts counting afresh instead of pulsing.
 */
export function useAppearHaptic(
  count: number,
  options: { resetKey?: string; element?: () => Element | null } = {},
): void {
  const previous = useRef<{ key: string | undefined; count: number } | null>(null);
  const element = useRef(options.element);
  useEffect(() => {
    element.current = options.element;
  });
  const { resetKey } = options;
  useEffect(() => {
    const before = previous.current;
    previous.current = { key: resetKey, count };
    if (before && before.key === resetKey && count > before.count) {
      triggerHaptic('cardAppear', { element: element.current?.() });
    }
  }, [count, resetKey]);
}

/** For server components: renders nothing, plays `cardAppear` when `count` grows. */
export function AppearHaptic({ count }: { count: number }) {
  useAppearHaptic(count);
  return null;
}
