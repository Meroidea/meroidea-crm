import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileMatchesAccept } from '@/components/forms/file-drop-zone';
import {
  DEFAULT_HAPTIC_PREFS,
  HAPTIC_PATTERNS,
  HAPTICS_STORAGE_KEY,
  getHapticCapabilities,
  getHapticPrefs,
  normalizePattern,
  resetHapticsForTests,
  setHapticPrefs,
  triggerHaptic,
} from '@/lib/haptics';
import { isIosDevice } from '@/lib/haptics-ios';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

let clock = 1_000;

function browser({
  vibrate,
  touch = 0,
  switchControl = false,
  storage = memoryStorage(),
  reducedMotion = false,
  userAgent = 'Mozilla/5.0 (X11; Linux x86_64)',
}: {
  vibrate?: (pattern: number[]) => boolean;
  touch?: number;
  switchControl?: boolean;
  storage?: ReturnType<typeof memoryStorage>;
  reducedMotion?: boolean;
  userAgent?: string;
} = {}) {
  const clicks: number[] = [];
  const body = { appendChild: vi.fn() };
  vi.stubGlobal('window', {
    localStorage: storage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout: (callback: () => void) => {
      callback();
      return 0;
    },
    matchMedia: () => ({ matches: reducedMotion }),
  });
  vi.stubGlobal('navigator', {
    maxTouchPoints: touch,
    userAgent,
    ...(vibrate ? { vibrate } : {}),
  });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    body,
    getElementById: () => null,
    createElement: (tag: string) => ({
      tag,
      style: {},
      dataset: {},
      isConnected: true,
      setAttribute: vi.fn(),
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
      click: () => clicks.push(clock),
    }),
  });
  vi.stubGlobal('HTMLInputElement', function HTMLInputElement() {});
  if (switchControl) {
    Object.defineProperty(
      (globalThis as unknown as { HTMLInputElement: { prototype: object } }).HTMLInputElement
        .prototype,
      'switch',
      { value: false },
    );
  }
  vi.stubGlobal('performance', { now: () => clock });
  return { clicks, storage };
}

beforeEach(() => {
  clock = 1_000;
  resetHapticsForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('haptic patterns', () => {
  it('keep every pulse between 5 and 35 ms', () => {
    for (const pattern of Object.values(HAPTIC_PATTERNS)) {
      pattern.forEach((ms, index) => {
        if (index % 2 === 0) {
          expect(ms).toBeGreaterThanOrEqual(5);
          expect(ms).toBeLessThanOrEqual(35);
        }
      });
    }
  });

  it('clamp a long buzz and a long gap instead of playing them', () => {
    expect(normalizePattern([500, 1000, 1, Number.NaN])).toEqual([35, 100, 5, 0]);
  });
});

describe('triggering', () => {
  it('does nothing and does not throw when rendered on the server', () => {
    expect(triggerHaptic('tap')).toBe(false);
    expect(getHapticCapabilities()).toEqual({ vibrate: false, iosSwitch: false, audio: false });
  });

  it('vibrates the pattern on a device with a motor', () => {
    const vibrate = vi.fn(() => true);
    browser({ vibrate, touch: 5 });
    expect(triggerHaptic('success')).toBe(true);
    expect(vibrate).toHaveBeenCalledWith([10, 40, 20]);
  });

  it('survives a browser that throws from vibrate', () => {
    browser({
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(() => triggerHaptic('tap')).not.toThrow();
  });

  it('ticks the hidden switch once per pulse on an iPhone', () => {
    const { clicks } = browser({ touch: 5, switchControl: true });
    expect(getHapticCapabilities().iosSwitch).toBe(true);
    triggerHaptic('warning');
    expect(clicks).toHaveLength(2);
  });

  it('does not use the switch on desktop Safari, which has no Taptic Engine', () => {
    browser({ touch: 0, switchControl: true });
    expect(getHapticCapabilities().iosSwitch).toBe(false);
  });

  it('recognises an iPhone by its user agent when WebKit does not expose the switch property', () => {
    browser({
      touch: 5,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15',
    });
    expect(getHapticCapabilities().iosSwitch).toBe(true);
  });

  it('recognises an iPad that reports itself as a Mac', () => {
    browser({ touch: 5, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
    expect(isIosDevice()).toBe(true);
  });

  it('treats Firefox for Android (no vibrate, not iOS) as having no device haptics', () => {
    browser({ touch: 5, userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Firefox/132.0' });
    expect(getHapticCapabilities()).toMatchObject({ vibrate: false, iosSwitch: false });
  });

  it('does not tick from script on an iPhone tap the control already ticked for', () => {
    const { clicks } = browser({ touch: 5, switchControl: true });
    expect(triggerHaptic('tap', { device: false })).toBe(true);
    expect(clicks).toHaveLength(0);
  });

  it('plays twenty card arrivals at once as one pulse', () => {
    const vibrate = vi.fn(() => true);
    browser({ vibrate });
    const played = Array.from({ length: 20 }, () => triggerHaptic('cardAppear'));
    expect(played.filter(Boolean)).toHaveLength(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
    clock += 500;
    expect(triggerHaptic('cardAppear')).toBe(true);
  });

  it('lets a drop swallow the soft pulse that follows straight after it', () => {
    const vibrate = vi.fn(() => true);
    browser({ vibrate });
    triggerHaptic('drop');
    clock += 50;
    expect(triggerHaptic('soft')).toBe(false);
  });

  it('stays silent when the person turned feedback off', () => {
    const vibrate = vi.fn(() => true);
    browser({ vibrate });
    setHapticPrefs({ hapticsEnabled: false });
    expect(triggerHaptic('tap')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('still vibrates for people who ask for reduced motion', () => {
    const vibrate = vi.fn(() => true);
    browser({ vibrate, reducedMotion: true });
    expect(triggerHaptic('tap')).toBe(true);
    expect(vibrate).toHaveBeenCalled();
  });
});

describe('preferences', () => {
  it('default to feedback on and sound off', () => {
    browser();
    expect(getHapticPrefs()).toEqual({ hapticsEnabled: true, soundFeedbackEnabled: false });
    expect(DEFAULT_HAPTIC_PREFS.soundFeedbackEnabled).toBe(false);
  });

  it('are saved to and read back from localStorage', () => {
    const { storage } = browser();
    setHapticPrefs({ soundFeedbackEnabled: true });
    expect(JSON.parse(storage.data.get(HAPTICS_STORAGE_KEY) ?? '{}')).toEqual({
      hapticsEnabled: true,
      soundFeedbackEnabled: true,
    });
    resetHapticsForTests();
    browser({ storage });
    expect(getHapticPrefs().soundFeedbackEnabled).toBe(true);
  });

  it('fall back to the defaults when the stored value is corrupt', () => {
    browser({ storage: memoryStorage({ [HAPTICS_STORAGE_KEY]: '{not json' }) });
    expect(getHapticPrefs()).toEqual(DEFAULT_HAPTIC_PREFS);
  });

  it('keep the same object until something changes, for useSyncExternalStore', () => {
    browser();
    const first = getHapticPrefs();
    expect(setHapticPrefs({ hapticsEnabled: true })).toBe(first);
    expect(getHapticPrefs()).toBe(first);
  });
});

describe('dropped files', () => {
  it('match extensions, wildcard types and exact types from an accept list', () => {
    expect(fileMatchesAccept({ name: 'Rates.XLSX', type: '' }, '.csv,.xlsx')).toBe(true);
    expect(fileMatchesAccept({ name: 'r.jpg', type: 'image/jpeg' }, 'image/*')).toBe(true);
    expect(fileMatchesAccept({ name: 'a.csv', type: 'text/csv' }, 'text/csv')).toBe(true);
    expect(fileMatchesAccept({ name: 'run.exe', type: '' }, '.pdf,image/*')).toBe(false);
    expect(fileMatchesAccept({ name: 'any.bin', type: '' }, '')).toBe(true);
  });
});
