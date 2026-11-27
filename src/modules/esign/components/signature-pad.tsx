'use client';

import { Eraser } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Captures a signature or initials as a PNG, drawn with a finger, pen or mouse, or typed and set
 * in a handwriting-style font. Only the image is sent; the server checks it is a real PNG.
 */

const TYPE_STYLES = [
  { label: 'Script', font: '"Segoe Script", "Brush Script MT", "Apple Chancery", cursive' },
  { label: 'Slanted', font: 'italic 600 1em Georgia, "Times New Roman", serif' },
  { label: 'Plain', font: '500 1em "Helvetica Neue", Arial, sans-serif' },
] as const;

const INK = '#141a33';

/** The drawn area cropped to what was drawn, with a little margin, as base64 PNG (no prefix). */
function trimmedPng(source: HTMLCanvasElement): string | null {
  const context = source.getContext('2d');
  if (!context) return null;
  const { width, height } = source;
  const pixels = context.getImageData(0, 0, width, height).data;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 10) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const pad = 8;
  left = Math.max(left - pad, 0);
  top = Math.max(top - pad, 0);
  right = Math.min(right + pad, width - 1);
  bottom = Math.min(bottom + pad, height - 1);
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out
    .getContext('2d')
    ?.drawImage(source, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png').split(',')[1] ?? null;
}

export function SignaturePad({
  kind,
  defaultText,
  onDone,
  onCancel,
}: {
  kind: 'signature' | 'initials';
  defaultText: string;
  onDone: (png: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [text, setText] = useState(defaultText);
  const [style, setStyle] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const word = kind === 'signature' ? 'signature' : 'initials';

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = element.getBoundingClientRect();
    element.width = Math.round(rect.width * ratio);
    element.height = Math.round(rect.height * ratio);
    const context = element.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = INK;
    context.lineWidth = 2.4;
    setDrawn(false);
  }, [mode]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const clear = () => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (element && context) {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, element.width, element.height);
      context.restore();
    }
    setDrawn(false);
  };

  const typedPng = (): string | null => {
    const value = text.trim();
    if (!value) return null;
    const out = document.createElement('canvas');
    const size = 96;
    out.width = 1400;
    out.height = 200;
    const context = out.getContext('2d');
    if (!context) return null;
    const family = TYPE_STYLES[style]?.font ?? TYPE_STYLES[0].font;
    context.font = family.includes('1em')
      ? family.replace('1em', `${size}px`)
      : `${size}px ${family}`;
    context.fillStyle = INK;
    context.textBaseline = 'middle';
    context.fillText(value, 20, 100, 1360);
    return trimmedPng(out);
  };

  const finish = () => {
    const png = mode === 'draw' ? (canvas.current ? trimmedPng(canvas.current) : null) : typedPng();
    if (png) onDone(png);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={`How to add your ${word}`}
        className="flex gap-1 rounded-lg bg-muted p-1"
      >
        {(['draw', 'type'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={mode === option}
            onClick={() => setMode(option)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium',
              mode === option ? 'bg-card shadow-sm' : 'text-muted-foreground',
            )}
          >
            {option === 'draw' ? 'Draw' : 'Type'}
          </button>
        ))}
      </div>

      {mode === 'draw' ? (
        <div className="flex flex-col gap-2">
          <canvas
            ref={canvas}
            aria-label={`Draw your ${word} here`}
            className="h-44 w-full touch-none rounded-lg border-2 border-dashed bg-card"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              last.current = point(event);
              const context = canvas.current?.getContext('2d');
              if (context) {
                context.beginPath();
                context.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
                context.fillStyle = INK;
                context.fill();
              }
              setDrawn(true);
            }}
            onPointerMove={(event) => {
              if (!last.current) return;
              const next = point(event);
              const context = canvas.current?.getContext('2d');
              if (!context) return;
              const mid = { x: (last.current.x + next.x) / 2, y: (last.current.y + next.y) / 2 };
              context.beginPath();
              context.moveTo(last.current.x, last.current.y);
              context.quadraticCurveTo(last.current.x, last.current.y, mid.x, mid.y);
              context.lineTo(next.x, next.y);
              context.stroke();
              last.current = next;
            }}
            onPointerUp={() => {
              last.current = null;
            }}
            onPointerCancel={() => {
              last.current = null;
            }}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Sign inside the box</span>
            <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={!drawn}>
              <Eraser aria-hidden /> Clear
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="typed-signature">Your {word}</Label>
            <Input
              id="typed-signature"
              value={text}
              maxLength={kind === 'signature' ? 80 : 8}
              onChange={(event) => setText(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2" role="radiogroup" aria-label="Style">
            {TYPE_STYLES.map((option, index) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={style === index}
                onClick={() => setStyle(index)}
                className={cn(
                  'truncate rounded-lg border bg-card px-4 py-2 text-left text-2xl',
                  style === index && 'border-primary ring-2 ring-primary/30',
                )}
                style={{
                  font: option.font.includes('1em')
                    ? option.font.replace('1em', '1.5rem')
                    : `1.5rem ${option.font}`,
                }}
              >
                {text.trim() || option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={finish} disabled={mode === 'draw' ? !drawn : !text.trim()}>
          Use this {word}
        </Button>
      </div>
    </div>
  );
}
