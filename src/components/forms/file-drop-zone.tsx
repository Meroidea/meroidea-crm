'use client';

import { Slot } from 'radix-ui';
import { useRef, useState, type ComponentProps, type DragEvent } from 'react';

import { popElement, triggerHaptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';

/** Whether a file matches an `accept` list (".pdf", "image/*", "text/csv"). Empty accepts all. */
export function fileMatchesAccept(file: Pick<File, 'name' | 'type'>, accept?: string): boolean {
  const rules = (accept ?? '')
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Lets files be dropped onto an area that already holds an `<input type="file">`. Dropped files
 * are handed to that input and its `change` event fires, so the input's own `onChange` (and the
 * checks after it) run exactly as if the files had been chosen. Files the input's `accept` list
 * refuses are left out; the server still checks every file it receives.
 *
 * Feel (ADR-073): a soft pulse when files are dragged in, a grounded `drop` and a spring when
 * they land, a `warning` when nothing dropped was accepted.
 */
export function FileDropZone({
  asChild = false,
  disabled = false,
  className,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  ...props
}: ComponentProps<'div'> & { asChild?: boolean; disabled?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div';
  const zone = useRef<HTMLDivElement>(null);
  // dragenter/dragleave fire for every child crossed; count them so the highlight never flickers.
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };

  return (
    <Comp
      ref={zone}
      data-slot="file-drop-zone"
      data-dragging={dragging || undefined}
      className={cn(
        'transition-[box-shadow,background-color,border-color] duration-150 data-dragging:border-primary data-dragging:bg-accent/60 data-dragging:ring-2 data-dragging:ring-primary/40',
        className,
      )}
      onDragEnter={(event: DragEvent<HTMLDivElement>) => {
        onDragEnter?.(event);
        if (disabled || !carriesFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        if (depth.current === 1) {
          setDragging(true);
          triggerHaptic('soft');
        }
      }}
      onDragOver={(event: DragEvent<HTMLDivElement>) => {
        onDragOver?.(event);
        if (disabled || !carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event: DragEvent<HTMLDivElement>) => {
        onDragLeave?.(event);
        if (disabled || !carriesFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        onDrop?.(event);
        if (disabled || !carriesFiles(event)) return;
        event.preventDefault();
        reset();
        const input = zone.current?.querySelector<HTMLInputElement>('input[type="file"]');
        if (!input || input.disabled) return;
        const accepted = Array.from(event.dataTransfer.files).filter((file) =>
          fileMatchesAccept(file, input.accept),
        );
        const files = input.multiple ? accepted : accepted.slice(0, 1);
        if (files.length === 0) {
          triggerHaptic('warning', { element: zone.current });
          return;
        }
        const transfer = new DataTransfer();
        files.forEach((file) => transfer.items.add(file));
        input.files = transfer.files;
        triggerHaptic('drop');
        popElement(zone.current, 'drop');
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }}
      {...props}
    />
  );
}
