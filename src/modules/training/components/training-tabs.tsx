import Link from 'next/link';

import { cn } from '@/lib/utils';

/** The training area's sections; each appears only to those it is for. */
export function TrainingTabs({
  active,
  team,
  manage,
}: {
  active: 'mine' | 'team' | 'manage';
  team: boolean;
  manage: boolean;
}) {
  const tabs = [
    { key: 'mine', label: 'My training', href: '/training', show: true },
    { key: 'team', label: 'My staff', href: '/training/team', show: team },
    { key: 'manage', label: 'Courses', href: '/training/manage', show: manage },
  ].filter((tab) => tab.show);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Training sections" className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? 'page' : undefined}
          className={cn(
            '-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground',
            active === tab.key && 'border-primary font-medium text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
