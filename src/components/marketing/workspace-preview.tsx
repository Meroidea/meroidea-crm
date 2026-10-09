'use client';

import {
  BarChart3,
  BatteryFull,
  CalendarCheck,
  FolderCheck,
  Settings,
  Users,
  Wifi,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useRef } from 'react';

import { AdminPortalDemo } from '@/components/marketing/admin-portal-demo';
import { useScrollProgress, type TiltFrame } from '@/components/motion/use-scroll-progress';

const DOCK_APPS: { icon: LucideIcon; tint: string }[] = [
  { icon: Users, tint: 'var(--chart-1)' },
  { icon: Workflow, tint: 'var(--chart-3)' },
  { icon: CalendarCheck, tint: 'var(--chart-4)' },
  { icon: FolderCheck, tint: 'var(--chart-2)' },
  { icon: BarChart3, tint: 'var(--chart-5)' },
  { icon: Settings, tint: 'var(--muted-foreground)' },
];

const TILT = {
  visibleShare: 0.46,
  restScale: 1,
  perspective: 900,
  minAngle: 55,
  maxAngle: 80,
  // The sticky site header (h-16).
  topInset: 64,
};

export function WorkspacePreview() {
  const headingRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  // Written straight to the elements, once per frame, instead of through React state: the
  // tablet holds the whole demo, and re-rendering it on every scroll tick is what made the
  // motion stutter. Only transform and opacity change, so the browser can animate them on the
  // compositor without laying out or repainting the page.
  const apply = useCallback(({ progress, restAngle, restShift }: TiltFrame) => {
    const rest = 1 - progress;
    const scale = TILT.restScale + (1 - TILT.restScale) * progress;
    // Starts laid far back with only its top ~46% on screen, cut off by the bottom edge of the
    // screen, then straightens and rises as the reader scrolls it into place.
    if (frameRef.current) {
      frameRef.current.style.transform = `rotateX(${(restAngle * rest).toFixed(2)}deg) scale(${scale.toFixed(3)})`;
    }
    if (stageRef.current) {
      stageRef.current.style.transform = `translate3d(0, ${(restShift * rest).toFixed(1)}px, 0)`;
    }
    if (headingRef.current) {
      headingRef.current.style.transform = `translate3d(0, ${(24 * rest).toFixed(1)}px, 0)`;
      headingRef.current.style.opacity = (0.4 + 0.6 * progress).toFixed(3);
    }
  }, []);

  const { ref, drawnRef } = useScrollProgress<HTMLDivElement, HTMLDivElement>(TILT, apply);

  return (
    <section
      id="product"
      className="mx-auto w-full max-w-[68rem] px-4 pt-0 pb-20 sm:px-10 sm:pb-32 lg:px-14"
    >
      <div
        ref={headingRef}
        className="mx-auto max-w-2xl text-center will-change-[transform,opacity]"
        style={{ transform: 'translate3d(0, 24px, 0)', opacity: 0.4 }}
      >
        <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          One platform, one login
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          Everything the business runs on, in one place
        </h2>
      </div>

      {/* The vanishing point sits on the hinge (top edge), so the near edge widens towards the
          reader and the tablet never flips over. */}
      <div
        ref={(node) => {
          ref.current = node;
          stageRef.current = node;
        }}
        style={{ perspective: `${TILT.perspective}px`, perspectiveOrigin: '50% 0%' }}
        className="mt-8 will-change-transform"
      >
        <div
          ref={(node) => {
            drawnRef.current = node;
            frameRef.current = node;
          }}
          style={{ transform: `rotateX(${TILT.minAngle}deg) scale(${TILT.restScale})` }}
          className="relative mx-auto w-full max-w-[min(88%,26rem,calc((100svh-7rem)*2/3))] origin-top rounded-[1.75rem] border border-black bg-black p-[6px] shadow-[0_45px_80px_-30px_rgb(0_0_0/0.4)] will-change-transform sm:max-w-[calc((100svh-7rem)*4/3)] sm:rounded-[2rem] sm:p-2"
        >
          <span
            aria-hidden
            className="absolute top-[7px] left-1/2 size-[5px] -translate-x-1/2 rounded-full bg-neutral-700 sm:top-1/2 sm:left-[9px] sm:translate-x-0 sm:-translate-y-1/2"
          />

          <div
            aria-hidden
            className="relative aspect-[2/3] w-full overflow-hidden rounded-[1.4rem] bg-[radial-gradient(120%_120%_at_15%_0%,#dfe6ff_0%,#eceaff_38%,#f7f0ff_68%,#e3edff_100%)] sm:aspect-[4/3] sm:rounded-[1.6rem]"
          >
            <div className="flex h-full w-full flex-col px-3 pt-1.5 pb-2 sm:px-4 sm:pt-2">
              <div className="flex items-center justify-between px-1 text-[9px] font-semibold text-foreground/75 sm:text-[11px]">
                <span>9:41</span>
                <div className="flex items-center gap-1">
                  <Wifi className="size-2.5 sm:size-3" />
                  <BatteryFull className="size-3 sm:size-3.5" />
                </div>
              </div>

              <div className="mt-1.5 min-h-0 flex-1 sm:mt-2">
                <AdminPortalDemo />
              </div>

              <div className="mt-2 flex justify-center sm:mt-2.5">
                <div className="flex items-center gap-1.5 rounded-[1.1rem] bg-white/70 px-2 py-1.5 shadow-sm ring-1 ring-black/5 sm:gap-2 sm:px-2.5">
                  {DOCK_APPS.map(({ icon: Icon, tint }, index) => (
                    <span
                      key={index}
                      className="flex size-6 items-center justify-center rounded-[30%] text-white shadow-sm sm:size-8"
                      style={{ background: tint }}
                    >
                      <Icon className="size-3 sm:size-4" />
                    </span>
                  ))}
                </div>
              </div>

              <span className="mx-auto mt-1.5 block h-[3px] w-20 rounded-full bg-black/30 sm:w-28" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
