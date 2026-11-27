'use client';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Draws a PDF's pages with pdf.js, one canvas per page at the width of the column, and lays
 * whatever `overlay` returns over each page. Overlays position things in percentages of the page,
 * the same fractions fields are stored in, so they line up at any width.
 */

let worker: Worker | null = null;

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  if (!worker) {
    worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
    pdfjs.GlobalWorkerOptions.workerPort = worker;
  }
  return pdfjs;
}

type PageSize = { width: number; height: number };

export function PdfPages({
  url,
  overlay,
  onPagePointerDown,
  className,
}: {
  url: string;
  overlay?: (page: number) => ReactNode;
  /** A press on empty page, as fractions of that page. */
  onPagePointerDown?: (page: number, x: number, y: number) => void;
  className?: string;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        // No scripts in the file are run, and fonts are drawn by pdf.js itself.
        loaded = await pdfjs.getDocument({ url, isEvalSupported: false, enableXfa: false }).promise;
        const next: PageSize[] = [];
        for (let index = 1; index <= loaded.numPages; index += 1) {
          const viewport = (await loaded.getPage(index)).getViewport({ scale: 1 });
          next.push({ width: viewport.width, height: viewport.height });
        }
        if (cancelled) return;
        setSizes(next);
        setDoc(loaded);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [url]);

  if (failed) {
    return (
      <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        The document could not be shown. Reload the page to try again.
      </p>
    );
  }
  if (!doc) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <div className="aspect-[1/1.414] w-full animate-pulse rounded-md bg-muted" />
        <span className="sr-only">Loading the document…</span>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {sizes.map((size, index) => (
        <Page
          key={index}
          doc={doc}
          page={index + 1}
          size={size}
          overlay={overlay}
          onPointerDown={onPagePointerDown}
          total={sizes.length}
        />
      ))}
    </div>
  );
}

function Page({
  doc,
  page,
  size,
  total,
  overlay,
  onPointerDown,
}: {
  doc: PDFDocumentProxy;
  page: number;
  size: PageSize;
  total: number;
  overlay?: (page: number) => ReactNode;
  onPointerDown?: (page: number, x: number, y: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(page <= 2);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '600px 0px' },
    );
    const resized = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      // Re-draw only for a real change, not sub-pixel jitter.
      setWidth((current) => (Math.abs(current - next) > 8 ? next : current));
    });
    seen.observe(element);
    resized.observe(element);
    return () => {
      seen.disconnect();
      resized.disconnect();
    };
  }, []);

  useEffect(() => {
    const target = canvas.current;
    if (!visible || !target || width === 0) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let cancelled = false;
    (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: (width * ratio) / size.width });
      target.width = Math.floor(viewport.width);
      target.height = Math.floor(viewport.height);
      task = pdfPage.render({ canvas: target, viewport });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, size.width, visible, width]);

  return (
    <div
      ref={box}
      className="relative w-full overflow-hidden rounded-md border bg-white shadow-sm select-none"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
      onPointerDown={
        onPointerDown
          ? (event) => {
              if (event.target !== event.currentTarget && event.target !== canvas.current) return;
              const rect = event.currentTarget.getBoundingClientRect();
              onPointerDown(
                page,
                (event.clientX - rect.left) / rect.width,
                (event.clientY - rect.top) / rect.height,
              );
            }
          : undefined
      }
      aria-label={`Page ${page} of ${total}`}
      role="group"
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden />
      {overlay?.(page)}
    </div>
  );
}
