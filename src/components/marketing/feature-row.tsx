import { BarChart3, FolderCheck, Users, Workflow, type LucideIcon } from 'lucide-react';

import { Reveal } from '@/components/motion/reveal';

type Feature = { icon: LucideIcon; title: string; body: string };

const FEATURES: Feature[] = [
  {
    icon: Users,
    title: 'Everyone you deal with',
    body: 'Customers, companies and partners in one record, with the whole history attached.',
  },
  {
    icon: Workflow,
    title: 'A pipeline that fits you',
    body: 'Name your own stages and fields. No two businesses sell the same way.',
  },
  {
    icon: FolderCheck,
    title: 'Work and documents',
    body: 'Follow-ups, checklists and files, so nothing waits on someone remembering.',
  },
  {
    icon: BarChart3,
    title: 'Answers without chasing',
    body: 'Who is following up, where deals stall, and what is coming — at a glance.',
  },
];

export function FeatureRow() {
  return (
    <section id="features" className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-8 sm:pb-32">
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, body }, index) => (
          <Reveal key={title} delay={index * 90}>
            <Icon aria-hidden className="size-5 text-primary" />
            <h3 className="mt-3 font-medium">{title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
