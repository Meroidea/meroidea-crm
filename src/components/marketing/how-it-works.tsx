import { Check, FileSpreadsheet, Globe, GripVertical, Plus } from 'lucide-react';
import type { ReactNode } from 'react';

import { Reveal } from '@/components/motion/reveal';
import { cn } from '@/lib/utils';

/* Every name and figure below is invented sample data, in the same spirit as the tablet demo. */

function WorkspaceSketch() {
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="rounded-md border bg-card px-2.5 py-1.5 text-xs text-foreground/80">
        Harbour Logistics
      </div>
      <div className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-accent px-2.5 py-1.5 text-xs font-medium text-primary">
        <Globe aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">harbour.meroidea.app</span>
        <Check aria-hidden className="ml-auto size-3.5 shrink-0" />
      </div>
    </div>
  );
}

function StagesSketch() {
  const stages = ['Qualified', 'Meeting', 'Proposal'];
  return (
    <div className="flex w-full flex-col gap-1.5">
      {stages.map((stage, index) => (
        <div
          key={stage}
          className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-foreground/80"
        >
          <GripVertical aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: `var(--chart-${index + 2})` }}
          />
          {stage}
        </div>
      ))}
      <div className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
        <Plus aria-hidden className="size-3 shrink-0" /> Add a stage
      </div>
    </div>
  );
}

function ImportSketch() {
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs text-foreground/80">
        <FileSpreadsheet aria-hidden className="size-3.5 shrink-0 text-primary" />
        <span className="truncate">contacts.csv</span>
        <span className="ml-auto shrink-0 text-muted-foreground">1,240 rows</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div className="h-full w-4/5 rounded-full bg-primary" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
        <span className="whitespace-nowrap text-muted-foreground">1,212 added</span>
        <span className="rounded-full border border-warning-border bg-warning px-1.5 py-0.5 font-medium whitespace-nowrap text-warning-text">
          28 possible duplicates
        </span>
      </div>
    </div>
  );
}

function TeamSketch() {
  const people = [
    { initials: 'JR', role: 'Owner', tint: 'var(--chart-1)' },
    { initials: 'AK', role: 'Manager', tint: 'var(--chart-4)' },
    { initials: 'PS', role: 'Sales', tint: 'var(--chart-3)' },
  ];
  return (
    <div className="flex w-full flex-col gap-1.5">
      {people.map(({ initials, role, tint }) => (
        <div
          key={initials}
          className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-xs"
        >
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
            style={{ background: tint }}
          >
            {initials}
          </span>
          <span className="h-1.5 w-12 rounded-full bg-border" />
          <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {role}
          </span>
        </div>
      ))}
    </div>
  );
}

const STEPS: { title: string; body: string; sketch: ReactNode }[] = [
  {
    title: 'Create your workspace',
    body: 'Tell us your company name and answer a short profile. Your workspace gets its own address and branding.',
    sketch: <WorkspaceSketch />,
  },
  {
    title: 'Shape it to your business',
    body: 'Rename the pipeline stages, add your lead sources and lost reasons. They are settings, not a development project.',
    sketch: <StagesSketch />,
  },
  {
    title: 'Bring your records in',
    body: 'Import your contacts from a spreadsheet. Likely duplicates are flagged for you instead of piling up.',
    sketch: <ImportSketch />,
  },
  {
    title: 'Invite your team',
    body: 'Give each person a role that decides what they can see: their own records, their team’s, or everything.',
    sketch: <TeamSketch />,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-8 sm:pb-32">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          How it works
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          From sign-up to a working workspace in an afternoon
        </h2>
        <p className="mt-4 text-muted-foreground">
          No consultants and no installation. Four steps, and you can do every one of them yourself.
        </p>
      </Reveal>

      {/* Phones: one swipeable row that bleeds to the screen edges, the next card peeking in to
          show there is more. Wider screens: a grid. Revealed as one piece, because a card that is
          only peeking would never count as scrolled into view on its own. */}
      <Reveal delay={120} className="mt-12">
        <ol className="relative -mx-4 flex snap-x snap-mandatory scroll-px-4 [scrollbar-width:none] gap-4 overflow-x-auto px-4 pb-5 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 [&::-webkit-scrollbar]:hidden">
          {/* The thread joining the four step numbers on wide screens. Decorative. */}
          <span
            aria-hidden
            className="pointer-events-none absolute top-[calc(2.375rem+1px)] right-[12.5%] left-[12.5%] hidden h-px bg-primary/25 lg:block"
          />

          {STEPS.map(({ title, body, sketch }, index) => (
            <li
              key={title}
              className="w-[78vw] max-w-xs shrink-0 snap-start sm:w-auto sm:max-w-none"
            >
              <div className="group relative flex h-full flex-col rounded-xl border bg-card p-5 transition-shadow duration-300 hover:shadow-lg">
                {/* The same thread, continued across the card and stopping at the end steps. Hidden
                  in the two-by-two layout, where the steps no longer sit in one row. */}
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute top-[2.375rem] h-px bg-primary/25 sm:hidden lg:block',
                    index === 0 ? 'left-1/2' : 'left-0',
                    // On phones the thread also bridges the gap to the next card in the row.
                    index === STEPS.length - 1 ? 'right-1/2' : '-right-4 sm:right-0',
                  )}
                />
                <span className="relative mx-auto flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-sm ring-4 ring-card">
                  {index + 1}
                </span>

                <div
                  aria-hidden
                  className="mt-5 flex min-h-[8.5rem] items-center rounded-lg bg-muted p-3 transition-colors duration-300 group-hover:bg-accent/60"
                >
                  {sketch}
                </div>

                <h3 className="mt-5 font-medium">{title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Reveal>
    </section>
  );
}
