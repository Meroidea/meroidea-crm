'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Input } from '@/components/ui/input';

import type { TeamMemberProgress } from '../queries';
import { ProgressRing } from './progress-ring';

/** Everyone in the business with their overall training completion; opens a person's detail. */
export function TeamGrid({ people }: { people: TeamMemberProgress[] }) {
  const [query, setQuery] = useState('');
  const shown = people.filter((person) =>
    person.fullName.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto w-full max-w-xl">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search staff"
          placeholder="Search staff…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
        />
      </div>
      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No one matches that.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((person) => (
            <li key={person.userId}>
              <Link
                href={`/training/team/${person.userId}`}
                className="flex h-full flex-col items-center gap-2 rounded-xl border bg-card px-3 py-4 text-center transition-colors hover:bg-muted/60"
              >
                <span className="line-clamp-2 text-sm font-medium" data-sensitive>
                  {person.fullName}
                </span>
                <ProgressRing
                  percent={person.total === 0 ? null : person.percent}
                  size={88}
                  stroke={9}
                  label={`${person.fullName}'s training completed`}
                />
                <span className="text-xs text-muted-foreground">
                  {person.total === 0
                    ? 'Nothing assigned'
                    : `${person.passed} of ${person.total} ${person.total === 1 ? 'module' : 'modules'} · ${person.roleName}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
