import { Layers, MapPin, ShieldCheck } from 'lucide-react';

import { LogoCloud } from '@/components/marketing/logo-cloud';
import { Reveal } from '@/components/motion/reveal';

const PRINCIPLES = [
  {
    icon: Layers,
    title: 'Configured, not customised',
    body: 'Stages, fields, labels and roles are settings a manager can change — not a quote from a developer.',
  },
  {
    icon: ShieldCheck,
    title: 'Your data stays yours',
    body: 'Every record is exportable, every access is logged, and nothing is locked behind a proprietary format.',
  },
  {
    icon: MapPin,
    title: 'Built and hosted in Sydney',
    body: 'Personal data is stored in Australia, close to the people whose business depends on it.',
  },
];

export function AboutSection() {
  return (
    <section id="about" className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-8 sm:pb-32">
      <div className="grid gap-12 lg:grid-cols-[0.95fr_1fr] lg:gap-16">
        <Reveal>
          <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            About us
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            We built the system we needed ourselves
          </h2>
          <div className="mt-5 space-y-4 text-muted-foreground">
            <p>
              Meroidea began inside a consulting business in Sydney that was run on spreadsheets,
              shared inboxes and memory. Work got done, but nobody could answer the simple
              questions: who is following up, where things are stuck, what is coming next month.
            </p>
            <p>
              The software on offer was either too general to fit how the business actually worked,
              or so tied to one industry that it could never fit anyone else. So we built a platform
              a business shapes to itself — and kept it industry-neutral at its core.
            </p>
          </div>
        </Reveal>

        <div className="flex flex-col gap-6">
          {PRINCIPLES.map(({ icon: Icon, title, body }, index) => (
            <Reveal
              key={title}
              delay={120 + index * 110}
              className="flex gap-4 border-b pb-6 last:border-b-0 last:pb-0"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                <Icon aria-hidden className="size-5" />
              </span>
              <div>
                <h3 className="font-medium">{title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>

      <LogoCloud />
    </section>
  );
}
