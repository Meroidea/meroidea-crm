'use client';

import { useId } from 'react';

import { useHaptics } from '@/components/haptics/haptics-provider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { HapticPattern } from '@/lib/haptics';

const SAMPLES: { pattern: HapticPattern; label: string }[] = [
  { pattern: 'tap', label: 'Tap' },
  { pattern: 'cardAppear', label: 'New card' },
  { pattern: 'drop', label: 'Drop' },
  { pattern: 'success', label: 'Success' },
  { pattern: 'warning', label: 'Warning' },
];

/** "Tactile & haptic feedback" preferences, kept in this browser (ADR-073). */
export function HapticsSettings() {
  const { prefs, setPrefs, capabilities, trigger } = useHaptics();
  const hapticsId = useId();
  const soundId = useId();

  const deviceNote = !capabilities
    ? null
    : capabilities.vibrate
      ? 'This device vibrates.'
      : capabilities.iosSwitch
        ? 'This iPhone gives a light tick for single taps; longer patterns may feel like one tick.'
        : 'This device has no vibration motor, so you will see a small spring instead, and hear a click if sound is on.';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={hapticsId} className="text-sm font-medium">
            Tactile &amp; haptic feedback
          </Label>
          <p className="text-sm text-muted-foreground">
            A light touch when you press, drop or save something.
            {deviceNote && <> {deviceNote}</>}
          </p>
        </div>
        <Switch
          id={hapticsId}
          checked={prefs.hapticsEnabled}
          onCheckedChange={(checked) => setPrefs({ hapticsEnabled: checked })}
        />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={soundId} className="text-sm font-medium">
            Click sound
          </Label>
          <p className="text-sm text-muted-foreground">
            A very soft click with each touch. Useful on computers, which cannot vibrate.
          </p>
        </div>
        <Switch
          id={soundId}
          checked={prefs.soundFeedbackEnabled}
          disabled={!prefs.hapticsEnabled || capabilities?.audio === false}
          onCheckedChange={(checked) => setPrefs({ soundFeedbackEnabled: checked })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Try it:</span>
        {SAMPLES.map(({ pattern, label }) => (
          <Button
            key={pattern}
            type="button"
            variant="outline"
            size="sm"
            // The sample plays itself on click (with its spring), not the press's own tap.
            data-haptic="off"
            disabled={!prefs.hapticsEnabled}
            onClick={(event) => trigger(pattern, { element: event.currentTarget })}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Saved on this device only. Animations follow your device&apos;s reduce-motion setting.
      </p>
    </div>
  );
}
