import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarCheck,
  CheckCircle2,
  FileCheck2,
  FolderCheck,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  Phone,
  Plus,
  Search,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';

/*
 * An illustrative home screen for the marketing page, in the iPadOS idiom. Object names follow the
 * code defaults (docs/terminology.md), companies are fictional and every figure is synthetic.
 * Phones get a portrait subset; the full board shows from `sm` up.
 */

const RAIL: { icon: LucideIcon; active?: boolean; badge?: boolean }[] = [
  { icon: LayoutDashboard, active: true },
  { icon: Users },
  { icon: KanbanSquare },
  { icon: CalendarCheck, badge: true },
  { icon: FolderCheck },
  { icon: BarChart3 },
];

const PIPELINE_TREND = [22, 26, 24, 31, 29, 36, 34, 41, 39, 47];

type Kpi = {
  label: string;
  value: string;
  delta: string;
  up: boolean;
  kind: 'spark' | 'ring' | 'bar' | 'plain';
  amount?: number;
};

const KPIS: Kpi[] = [
  { label: 'Weighted pipeline', value: '$486k', delta: '12%', up: true, kind: 'spark' },
  { label: 'Win rate', value: '38%', delta: '4 pts', up: true, kind: 'ring', amount: 38 },
  { label: 'Follow-ups on time', value: '92%', delta: '3 pts', up: true, kind: 'bar', amount: 92 },
  { label: 'Days to close', value: '21', delta: '3 days', up: false, kind: 'plain' },
];

type Card = {
  name: string;
  value: string;
  who: string;
  tint: string;
  days: number;
  stale?: boolean;
};

const STAGES: { name: string; count: number; total: string; tint: string; cards: Card[] }[] = [
  {
    name: 'Qualified',
    count: 14,
    total: '$128k',
    tint: 'var(--chart-2)',
    cards: [
      { name: 'Kestrel Freight', value: '$18k', who: 'AK', tint: 'var(--chart-5)', days: 2 },
      { name: 'Northwind Dental', value: '$9.5k', who: 'JB', tint: 'var(--chart-3)', days: 4 },
    ],
  },
  {
    name: 'Meeting',
    count: 9,
    total: '$142k',
    tint: 'var(--chart-3)',
    cards: [
      { name: 'Cedarline Homes', value: '$32k', who: 'PR', tint: 'var(--chart-1)', days: 3 },
      {
        name: 'Lumen Studio',
        value: '$14k',
        who: 'AK',
        tint: 'var(--chart-5)',
        days: 11,
        stale: true,
      },
    ],
  },
  {
    name: 'Proposal',
    count: 6,
    total: '$117k',
    tint: 'var(--chart-4)',
    cards: [
      { name: 'Harbour Logistics', value: '$41k', who: 'JB', tint: 'var(--chart-3)', days: 5 },
      { name: 'Vantage Partners', value: '$23k', who: 'SM', tint: 'var(--chart-4)', days: 1 },
    ],
  },
  {
    name: 'Negotiation',
    count: 3,
    total: '$99k',
    tint: 'var(--chart-1)',
    cards: [{ name: 'Beacon Health', value: '$58k', who: 'PR', tint: 'var(--chart-1)', days: 6 }],
  },
];

/** Won per month (bars) and forecast (line), $k. */
const FORECAST = {
  months: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'],
  won: [38, 52, 44, 61, 57, 72, null, null],
  forecast: [40, 48, 50, 58, 62, 70, 81, 88],
  target: 75,
};

const ACTIONS: { icon: LucideIcon; title: string; why: string; cta: string; hot?: boolean }[] = [
  {
    icon: Phone,
    title: 'Call Lumen Studio',
    why: 'No reply in 11 days · $14k at risk',
    cta: 'Call',
    hot: true,
  },
  {
    icon: FileCheck2,
    title: 'Verify 2 expiring documents',
    why: 'Beacon Health · due Friday',
    cta: 'Review',
  },
  {
    icon: Mail,
    title: 'Send proposal follow-up',
    why: 'Harbour Logistics opened it 3×',
    cta: 'Draft',
  },
];

const ACTIVITY: { who: string; tint: string; text: string; when: string }[] = [
  { who: 'PR', tint: 'var(--chart-1)', text: 'Beacon Health moved to Negotiation', when: '2m' },
  { who: 'JB', tint: 'var(--chart-3)', text: 'Logged a call with Harbour Logistics', when: '18m' },
  { who: 'AK', tint: 'var(--chart-5)', text: 'Verified contract for Kestrel Freight', when: '1h' },
  { who: 'SM', tint: 'var(--chart-4)', text: 'New lead from website · Vantage', when: '2h' },
];

const TEAM: { who: string; name: string; tint: string; won: string; quota: number }[] = [
  { who: 'PR', name: 'Priya R.', tint: 'var(--chart-1)', won: '$96k', quota: 88 },
  { who: 'JB', name: 'Jordan B.', tint: 'var(--chart-3)', won: '$81k', quota: 74 },
  { who: 'AK', name: 'Alex K.', tint: 'var(--chart-5)', won: '$64k', quota: 58 },
];

function Avatar({ who, tint, className = '' }: { who: string; tint: string; className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{ background: tint }}
    >
      {who}
    </span>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * 100;
    const y = 28 - ((point - min) / (max - min)) * 24;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-6 w-full text-primary">
      <polygon points={`0,30 ${coords.join(' ')} 100,30`} fill="currentColor" opacity="0.1" />
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Ring({ amount }: { amount: number }) {
  const circumference = 2 * Math.PI * 14;
  return (
    <svg viewBox="0 0 36 36" className="size-8 -rotate-90 sm:size-9">
      <circle cx="18" cy="18" r="14" fill="none" stroke="var(--muted)" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r="14"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${(circumference * amount) / 100} ${circumference}`}
      />
    </svg>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const Trend = kpi.up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="flex min-w-0 flex-col justify-between gap-1.5 rounded-xl border bg-card p-2.5 sm:p-3">
      <div className="flex items-center justify-between gap-1">
        <p className="truncate text-muted-foreground">{kpi.label}</p>
        <span
          className={`flex shrink-0 items-center gap-0.5 rounded-full px-1 py-px font-medium ${
            kpi.up || kpi.kind === 'plain'
              ? 'bg-accent text-accent-foreground'
              : 'bg-destructive/10 text-destructive-text'
          }`}
        >
          <Trend className="size-2.5" />
          {kpi.delta}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className="text-[15px] leading-none font-semibold tracking-tight sm:text-[19px]">
          {kpi.value}
        </p>
        {kpi.kind === 'ring' && kpi.amount !== undefined && <Ring amount={kpi.amount} />}
      </div>
      {kpi.kind === 'spark' && <Sparkline points={PIPELINE_TREND} />}
      {kpi.kind === 'bar' && kpi.amount !== undefined && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${kpi.amount}%` }} />
        </div>
      )}
      {kpi.kind === 'plain' && <p className="text-muted-foreground/80">faster than last quarter</p>}
    </div>
  );
}

function PipelineBoard({ stages }: { stages: typeof STAGES }) {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border bg-card p-2.5 sm:p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">Pipeline</p>
        <p className="text-muted-foreground">32 open · $486k</p>
      </div>
      <div
        className="mt-2 grid min-h-0 flex-1 gap-1.5"
        style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
      >
        {stages.map((stage) => (
          <div
            key={stage.name}
            className="flex min-h-0 min-w-0 flex-col gap-1 rounded-lg bg-muted/60 p-1.5"
          >
            <span className="h-[2px] rounded-full" style={{ background: stage.tint }} />
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate font-medium">{stage.name}</span>
              <span className="text-muted-foreground">{stage.count}</span>
            </div>
            <span className="-mt-0.5 font-semibold">{stage.total}</span>
            {stage.cards.map((card) => (
              <div key={card.name} className="rounded-md border bg-card px-1.5 py-1 shadow-xs">
                <p className="truncate font-medium">{card.name}</p>
                <div className="mt-0.5 flex items-center justify-between gap-1">
                  <span className="text-muted-foreground">{card.value}</span>
                  <span className="flex items-center gap-1">
                    <span
                      className={`rounded px-0.5 ${
                        card.stale ? 'bg-warning text-warning-text' : 'text-muted-foreground/80'
                      }`}
                    >
                      {card.days}d
                    </span>
                    <Avatar
                      who={card.who}
                      tint={card.tint}
                      className="size-3.5 text-[5px] sm:size-4 sm:text-[6px]"
                    />
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ForecastChart() {
  const max = 100;
  const step = 100 / FORECAST.months.length;
  const line = FORECAST.forecast
    .map(
      (value, index) =>
        `${(index * step + step / 2).toFixed(1)},${(60 - (value / max) * 56).toFixed(1)}`,
    )
    .join(' ');
  const targetY = 60 - (FORECAST.target / max) * 56;

  return (
    <div className="flex min-h-0 flex-col rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">Revenue vs forecast</p>
        <span className="flex items-center gap-2 text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-sm bg-primary" /> Won
          </span>
          <span className="flex items-center gap-1">
            <span className="h-px w-2.5 border-t border-dashed border-chart-4" /> Forecast
          </span>
        </span>
      </div>
      <p className="mt-1 text-[17px] leading-none font-semibold tracking-tight">
        $324k <span className="text-[9px] font-normal text-muted-foreground">won this year</span>
      </p>
      <svg viewBox="0 0 100 62" preserveAspectRatio="none" className="mt-2 min-h-0 w-full flex-1">
        <line
          x1="0"
          x2="100"
          y1={targetY}
          y2={targetY}
          stroke="var(--muted-foreground)"
          strokeOpacity="0.35"
          strokeDasharray="1.5 1.5"
          vectorEffect="non-scaling-stroke"
        />
        {FORECAST.won.map((value, index) =>
          value === null ? null : (
            <rect
              key={FORECAST.months[index]}
              x={index * step + step * 0.22}
              width={step * 0.56}
              y={60 - (value / max) * 56}
              height={(value / max) * 56}
              rx="1.2"
              fill="var(--primary)"
              opacity={0.35 + (index / FORECAST.won.length) * 0.65}
            />
          ),
        )}
        <polyline
          points={line}
          fill="none"
          stroke="var(--chart-4)"
          strokeWidth="1.5"
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-muted-foreground/80">
        {FORECAST.months.map((month) => (
          <span key={month}>{month}</span>
        ))}
      </div>
    </div>
  );
}

function NextActions({ items }: { items: typeof ACTIONS }) {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border bg-card p-2.5 sm:p-3">
      <p className="flex items-center gap-1 font-medium">
        <Sparkles className="size-2.5 text-primary" /> Next best actions
      </p>
      <div className="mt-2 flex min-h-0 flex-col gap-1.5 overflow-hidden">
        {items.map(({ icon: Icon, title, why, cta, hot }) => (
          <div key={title} className="flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-1.5">
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-md ${
                hot ? 'bg-warning text-warning-text' : 'bg-accent text-accent-foreground'
              }`}
            >
              <Icon className="size-2.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{title}</span>
              <span className="block truncate text-muted-foreground">{why}</span>
            </span>
            <span className="shrink-0 rounded-md bg-primary px-1.5 py-0.5 font-medium text-primary-foreground">
              {cta}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityFeed() {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border bg-card p-3">
      <p className="flex items-center justify-between font-medium">
        Live activity
        <span className="flex items-center gap-1 font-normal text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-chart-3 motion-reduce:animate-none" />
          now
        </span>
      </p>
      <ol className="relative mt-2 flex min-h-0 flex-col gap-2 overflow-hidden before:absolute before:top-1 before:bottom-1 before:left-[7px] before:w-px before:bg-border">
        {ACTIVITY.map((item) => (
          <li key={item.text} className="relative flex items-start gap-2">
            <Avatar
              who={item.who}
              tint={item.tint}
              className="size-4 text-[6px] ring-2 ring-card"
            />
            <span className="min-w-0 flex-1 truncate">{item.text}</span>
            <span className="shrink-0 text-muted-foreground/80">{item.when}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TeamTargets() {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border bg-card p-3">
      <p className="flex items-center justify-between font-medium">
        Team targets
        <span className="font-normal text-muted-foreground">Q3</span>
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {TEAM.map((person) => (
          <div key={person.name} className="flex items-center gap-2">
            <Avatar who={person.who} tint={person.tint} className="size-4 text-[6px]" />
            <span className="min-w-0 flex-1">
              <span className="flex justify-between gap-1">
                <span className="truncate font-medium">{person.name}</span>
                <span className="text-muted-foreground">{person.won}</span>
              </span>
              <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${person.quota}%`, opacity: 0.45 + person.quota / 180 }}
                />
              </span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-auto flex items-center gap-1 pt-2 text-muted-foreground">
        <CheckCircle2 className="size-2.5 text-primary" /> 73% of team target reached
      </p>
    </div>
  );
}

export function AdminPortalDemo() {
  return (
    <div className="flex h-full w-full overflow-hidden rounded-[0.9rem] bg-card text-[8px] shadow-lg ring-1 ring-black/5 sm:text-[9px]">
      <nav className="hidden w-10 shrink-0 flex-col items-center gap-2 border-r bg-muted/40 py-3 sm:flex">
        <span className="flex size-6 items-center justify-center rounded-[7px] bg-primary text-[9px] font-bold text-primary-foreground">
          M
        </span>
        <div className="mt-1 flex flex-col items-center gap-1.5">
          {RAIL.map(({ icon: Icon, active, badge }, index) => (
            <span
              key={index}
              className={`relative flex size-7 items-center justify-center rounded-lg ${
                active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground/70'
              }`}
            >
              <Icon className="size-3.5" />
              {badge && (
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-destructive" />
              )}
            </span>
          ))}
        </div>
        <span className="mt-auto flex size-7 items-center justify-center text-muted-foreground/70">
          <Settings className="size-3.5" />
        </span>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5 bg-background p-3 sm:gap-3 sm:p-4">
        <header className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] leading-none font-semibold tracking-tight sm:text-[16px]">
              Good morning, Jordan
            </p>
            <p className="mt-1 truncate text-muted-foreground">
              Tuesday · 3 things need you before lunch
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="hidden items-center gap-1.5 rounded-lg border bg-card px-2 py-1 text-muted-foreground sm:flex">
              <Search className="size-2.5" />
              Search or jump to…
              <kbd className="rounded border bg-muted px-1 text-[7px]">⌘K</kbd>
            </span>
            <span className="relative flex size-5 items-center justify-center rounded-full bg-card text-muted-foreground ring-1 ring-border sm:size-6">
              <Bell className="size-2.5" />
              <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-destructive" />
            </span>
            <span className="flex items-center gap-0.5 rounded-lg bg-primary px-1.5 py-1 font-medium text-primary-foreground">
              <Plus className="size-2.5" /> New
            </span>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {KPIS.map((kpi) => (
            <KpiCard key={kpi.label} kpi={kpi} />
          ))}
        </div>

        {/* Phones: pipeline and actions only. */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 sm:hidden">
          <PipelineBoard stages={STAGES.slice(1, 4)} />
          <NextActions items={ACTIONS.slice(0, 2)} />
        </div>

        <div className="hidden min-h-0 flex-1 grid-cols-[1.7fr_1fr] gap-2.5 sm:grid">
          <PipelineBoard stages={STAGES} />
          <ForecastChart />
        </div>
        <div className="hidden h-[31%] shrink-0 grid-cols-[1.25fr_1fr_0.9fr] gap-2.5 sm:grid">
          <NextActions items={ACTIONS} />
          <ActivityFeed />
          <TeamTargets />
        </div>
      </div>
    </div>
  );
}
