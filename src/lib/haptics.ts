/**
 * Tactile feedback (ADR-073): one small engine every part of the app calls, so a press, a drop
 * or a saved form feels the same everywhere.
 *
 * Each call does what the device can:
 * - phones with a vibration motor (Android browsers): `navigator.vibrate(pattern)`;
 * - iPhones (Safari has no `vibrate`): toggles a hidden `<input type="checkbox" switch>`, which
 *   iOS 17.4+ answers with a Taptic Engine tick. One tick per pulse, best effort;
 * - every device: an optional, muted-by-default soft click made with the Web Audio API (no audio
 *   files), and a short spring on the element involved, for desktops that cannot vibrate.
 *
 * Nothing here throws: a missing API, a blocked call or server rendering simply does nothing.
 * Preferences live in this browser's localStorage; `HapticsProvider` exposes them to React.
 */

export type HapticPattern = 'tap' | 'soft' | 'cardAppear' | 'drop' | 'success' | 'warning';

/** Vibration patterns in ms: pulse, gap, pulse… Pulses stay between 5 and 35 ms. */
export const HAPTIC_PATTERNS: Record<HapticPattern, readonly number[]> = {
  tap: [8],
  soft: [5],
  cardAppear: [6, 30, 10],
  drop: [18],
  success: [10, 40, 20],
  warning: [25, 50, 25],
};

export const HAPTIC_PATTERN_NAMES = Object.keys(HAPTIC_PATTERNS) as HapticPattern[];

export function isHapticPattern(value: unknown): value is HapticPattern {
  return typeof value === 'string' && Object.hasOwn(HAPTIC_PATTERNS, value);
}

const MIN_PULSE_MS = 5;
const MAX_PULSE_MS = 35;
const MAX_GAP_MS = 100;

/** Clamps pulses to 5–35 ms and gaps to 0–100 ms, so no caller can make a long buzz. */
export function normalizePattern(pattern: readonly number[]): number[] {
  return pattern.slice(0, 6).map((ms, index) => {
    const value = Number.isFinite(ms) ? Math.round(ms) : 0;
    return index % 2 === 0
      ? Math.min(MAX_PULSE_MS, Math.max(MIN_PULSE_MS, value))
      : Math.min(MAX_GAP_MS, Math.max(0, value));
  });
}

// ------------------------------------------------------------------------------------------
// Preferences
// ------------------------------------------------------------------------------------------

export type HapticPrefs = {
  /** Master switch for all tactile feedback: vibration, the iPhone tick, sound and springs. */
  hapticsEnabled: boolean;
  /** The soft click. Off unless the person turns it on. */
  soundFeedbackEnabled: boolean;
};

export const DEFAULT_HAPTIC_PREFS: HapticPrefs = Object.freeze({
  hapticsEnabled: true,
  soundFeedbackEnabled: false,
});

export const HAPTICS_STORAGE_KEY = 'meroidea:haptics';

let prefs: HapticPrefs = DEFAULT_HAPTIC_PREFS;
let prefsLoaded = false;
const listeners = new Set<() => void>();

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function parsePrefs(raw: string | null): HapticPrefs {
  if (!raw) return DEFAULT_HAPTIC_PREFS;
  try {
    const value = JSON.parse(raw) as Partial<HapticPrefs> | null;
    return {
      hapticsEnabled:
        typeof value?.hapticsEnabled === 'boolean'
          ? value.hapticsEnabled
          : DEFAULT_HAPTIC_PREFS.hapticsEnabled,
      soundFeedbackEnabled:
        typeof value?.soundFeedbackEnabled === 'boolean'
          ? value.soundFeedbackEnabled
          : DEFAULT_HAPTIC_PREFS.soundFeedbackEnabled,
    };
  } catch {
    return DEFAULT_HAPTIC_PREFS;
  }
}

function readStoredPrefs(): HapticPrefs {
  try {
    return parsePrefs(window.localStorage.getItem(HAPTICS_STORAGE_KEY));
  } catch {
    // Storage can be blocked (private mode, strict settings): use the defaults.
    return DEFAULT_HAPTIC_PREFS;
  }
}

/** The current preferences. Returns the same object until they change (useSyncExternalStore). */
export function getHapticPrefs(): HapticPrefs {
  if (!prefsLoaded && hasWindow()) {
    prefs = readStoredPrefs();
    prefsLoaded = true;
  }
  return prefs;
}

export function setHapticPrefs(patch: Partial<HapticPrefs>): HapticPrefs {
  const next = { ...getHapticPrefs(), ...patch };
  if (
    next.hapticsEnabled === prefs.hapticsEnabled &&
    next.soundFeedbackEnabled === prefs.soundFeedbackEnabled
  ) {
    return prefs;
  }
  prefs = next;
  if (hasWindow()) {
    try {
      window.localStorage.setItem(HAPTICS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not saved, but the choice still holds for this page.
    }
  }
  listeners.forEach((listener) => listener());
  return prefs;
}

/** Subscribes to preference changes, including ones made in another tab. */
export function subscribeHapticPrefs(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== HAPTICS_STORAGE_KEY) return;
    prefs = parsePrefs(event.newValue);
    prefsLoaded = true;
    listener();
  };
  if (hasWindow()) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (hasWindow()) window.removeEventListener('storage', onStorage);
  };
}

// ------------------------------------------------------------------------------------------
// What this device can do
// ------------------------------------------------------------------------------------------

export type HapticCapabilities = {
  /** A vibration motor reachable through `navigator.vibrate`. */
  vibrate: boolean;
  /** iOS 17.4+ Safari: the switch control's Taptic tick. */
  iosSwitch: boolean;
  /** The Web Audio API, for the soft click. */
  audio: boolean;
};

const NO_CAPABILITIES: HapticCapabilities = Object.freeze({
  vibrate: false,
  iosSwitch: false,
  audio: false,
});

let capabilities: HapticCapabilities | null = null;

export function getHapticCapabilities(): HapticCapabilities {
  if (!hasWindow() || typeof navigator === 'undefined') return NO_CAPABILITIES;
  if (capabilities) return capabilities;
  const vibrate = typeof navigator.vibrate === 'function';
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  // WebKit reflects the `switch` attribute as a property from Safari 17.4. Desktop Safari has it
  // too but no Taptic Engine, so only touch devices use it.
  const switchControl =
    typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype;
  const audioWindow = window as Window & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  capabilities = Object.freeze({
    vibrate,
    iosSwitch: !vibrate && touch && switchControl,
    audio:
      typeof audioWindow.AudioContext === 'function' ||
      typeof audioWindow.webkitAudioContext === 'function',
  });
  return capabilities;
}

/** Visual motion only: people who ask for less motion still get vibration (as iOS and Android do). */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------------------
// Coalescing: many calls at once make one clean pulse
// ------------------------------------------------------------------------------------------

/** A second call of the same pattern inside this window is dropped. */
const COALESCE_MS: Record<HapticPattern, number> = {
  tap: 40,
  soft: 120,
  cardAppear: 400,
  drop: 120,
  success: 250,
  warning: 250,
};

/** A stronger pattern swallows a weaker one that arrives right after it. */
const PRIORITY: Record<HapticPattern, number> = {
  soft: 0,
  tap: 1,
  cardAppear: 1,
  drop: 2,
  success: 3,
  warning: 3,
};
const SHADOW_MS = 150;

const lastFired = new Map<HapticPattern, number>();
let lastStrong: { at: number; priority: number } = { at: -Infinity, priority: -1 };

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function shouldFire(pattern: HapticPattern): boolean {
  const at = now();
  const previous = lastFired.get(pattern);
  if (previous !== undefined && at - previous < COALESCE_MS[pattern]) return false;
  if (at - lastStrong.at < SHADOW_MS && PRIORITY[pattern] < lastStrong.priority) return false;
  lastFired.set(pattern, at);
  lastStrong = { at, priority: PRIORITY[pattern] };
  return true;
}

// ------------------------------------------------------------------------------------------
// Outputs
// ------------------------------------------------------------------------------------------

function vibrate(pattern: number[]): void {
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw when the page has not been interacted with yet.
  }
}

let iosSwitchLabel: HTMLLabelElement | null = null;

function iosSwitch(): HTMLLabelElement {
  if (iosSwitchLabel?.isConnected) return iosSwitchLabel;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.dataset.hapticDriver = '';
  label.style.cssText =
    'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  // The synthetic click toggles the switch but must not reach the page's own click handlers.
  label.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('click', (event) => event.stopPropagation());
  document.body.appendChild(label);
  iosSwitchLabel = label;
  return label;
}

function iosTicks(pattern: number[]): void {
  try {
    const label = iosSwitch();
    label.click();
    // Later pulses are best effort: iOS may only honour the one inside the user's gesture.
    let delay = 0;
    for (let index = 1; index < pattern.length; index += 2) {
      delay += (pattern[index - 1] ?? 0) + (pattern[index] ?? 0);
      window.setTimeout(() => label.click(), delay);
    }
  } catch {
    // No DOM (or a locked-down one): nothing to do.
  }
}

let audioContext: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** Brighter for light patterns, darker for heavy ones. */
const TICK_TONE: Record<HapticPattern, { cutoff: number; gain: number }> = {
  soft: { cutoff: 2600, gain: 0.035 },
  tap: { cutoff: 2200, gain: 0.05 },
  cardAppear: { cutoff: 2400, gain: 0.04 },
  drop: { cutoff: 900, gain: 0.09 },
  success: { cutoff: 1800, gain: 0.06 },
  warning: { cutoff: 1100, gain: 0.07 },
};

function audio(): AudioContext | null {
  if (audioContext) return audioContext;
  const audioWindow = window as Window & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Context = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!Context) return null;
  const context = new Context();
  // 40 ms of white noise, made once: the raw material of every click.
  const length = Math.ceil(context.sampleRate * 0.04);
  noise = context.createBuffer(1, length, context.sampleRate);
  const samples = noise.getChannelData(0);
  for (let index = 0; index < length; index += 1) samples[index] = Math.random() * 2 - 1;
  audioContext = context;
  return context;
}

/** A soft, low-passed click per pulse: short noise through a filter with a fast decay. */
function tick(pattern: HapticPattern, steps: number[]): void {
  try {
    const context = audio();
    if (!context || !noise) return;
    if (context.state === 'suspended') void context.resume();
    const tone = TICK_TONE[pattern];
    let offset = 0;
    for (let index = 0; index < steps.length; index += 2) {
      const pulse = steps[index] ?? MIN_PULSE_MS;
      const start = context.currentTime + offset / 1000;
      const source = context.createBufferSource();
      source.buffer = noise;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = tone.cutoff;
      filter.Q.value = 0.7;
      const gain = context.createGain();
      const peak = tone.gain * (0.6 + pulse / MAX_PULSE_MS);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.004 + (pulse * 1.4) / 1000);
      source.connect(filter).connect(gain).connect(context.destination);
      source.start(start);
      source.stop(start + 0.04);
      offset += pulse + (steps[index + 1] ?? 0);
    }
  } catch {
    // Audio blocked or unavailable: stay silent.
  }
}

export type TactileMotion = 'drop' | 'appear' | 'success' | 'warning';

const MOTION_FOR: Partial<Record<HapticPattern, TactileMotion>> = {
  drop: 'drop',
  cardAppear: 'appear',
  success: 'success',
  warning: 'warning',
};

/**
 * Plays a short spring on an element (`[data-tactile]` keyframes in globals.css). Skipped when
 * feedback is off or the person asked for reduced motion.
 */
export function popElement(element: Element | null | undefined, motion: TactileMotion): void {
  if (!element || !hasWindow() || !getHapticPrefs().hapticsEnabled || prefersReducedMotion()) {
    return;
  }
  const target = element as HTMLElement;
  target.removeAttribute('data-tactile');
  // Reading layout restarts the animation when the same element pops twice in a row.
  void target.offsetWidth;
  target.setAttribute('data-tactile', motion);
  target.addEventListener('animationend', () => target.removeAttribute('data-tactile'), {
    once: true,
  });
}

export type TriggerOptions = {
  /** Gets a matching spring, so desktops without a motor still feel the moment. */
  element?: Element | null;
};

/**
 * Plays a pattern on whatever this device has. Returns whether anything was played (false when
 * feedback is off, the tab is hidden, or the same moment was just played).
 */
export function triggerHaptic(pattern: HapticPattern, options: TriggerOptions = {}): boolean {
  if (!hasWindow() || typeof document === 'undefined') return false;
  if (!getHapticPrefs().hapticsEnabled) return false;
  if (document.visibilityState === 'hidden') return false;
  if (!shouldFire(pattern)) return false;

  const steps = normalizePattern(HAPTIC_PATTERNS[pattern]);
  const can = getHapticCapabilities();
  if (can.vibrate) vibrate(steps);
  else if (can.iosSwitch) iosTicks(steps);
  if (getHapticPrefs().soundFeedbackEnabled && can.audio) tick(pattern, steps);
  const motion = MOTION_FOR[pattern];
  if (options.element && motion) popElement(options.element, motion);
  return true;
}

/** `haptics.tap()`, `haptics.drop(element)`… */
export const haptics = Object.freeze(
  Object.fromEntries(
    HAPTIC_PATTERN_NAMES.map((name) => [
      name,
      (element?: Element | null) => triggerHaptic(name, { element }),
    ]),
  ) as Record<HapticPattern, (element?: Element | null) => boolean>,
);

/** Test-only: forgets coalescing, cached capabilities and loaded preferences. */
export function resetHapticsForTests(): void {
  lastFired.clear();
  lastStrong = { at: -Infinity, priority: -1 };
  capabilities = null;
  prefs = DEFAULT_HAPTIC_PREFS;
  prefsLoaded = false;
  listeners.clear();
  iosSwitchLabel = null;
  audioContext = null;
  noise = null;
}
