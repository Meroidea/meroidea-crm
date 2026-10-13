import type { BreakRule, Loadings, ShiftBreak, TeamColor } from './rules';

export type RosterSummary = {
  id: string;
  /** Calendar days in the workspace timezone, both inclusive. */
  startsOn: string;
  endsOn: string;
  status: 'draft' | 'published';
  publishedAt: Date | null;
  /** Set once the worked hours are signed off for pay; the roster is locked from then. */
  authorisedAt: Date | null;
};

/** A shift expressed in the workspace's wall-clock time, ready to place on the grid. */
export type RosterShift = {
  id: string;
  /** Null while the shift is vacant. */
  userId: string | null;
  teamId: string | null;
  /** The day the shift starts on. */
  date: string;
  startTime: string;
  endTime: string;
  /** True when the shift ends on the day after it starts. */
  overnight: boolean;
  breaks: ShiftBreak[];
  /** True while the breaks follow the workspace's break rules. */
  autoBreaks: boolean;
  /** Unpaid break time. */
  breakMinutes: number;
  /** Worked time: length of the shift less the unpaid breaks. */
  paidMinutes: number;
  note: string | null;
  /** Staff have been shown this shift at least once. */
  published: boolean;
  /** Added or changed since staff were last shown it. */
  unpublishedChanges: boolean;
};

/** A published shift that was removed and whose removal has not been announced yet. */
export type RemovedShift = {
  id: string;
  userId: string | null;
  date: string;
  startTime: string;
  endTime: string;
};

export type RosterPerson = { userId: string; fullName: string };

export type RosterTeam = {
  id: string;
  name: string;
  color: TeamColor;
  /** Who can be rostered into the team. Only complete for someone who sees the whole roster. */
  memberIds: string[];
};

/** Time away that overlaps the roster, shown so nobody is rostered onto it by accident. */
export type RosterLeave = {
  userId: string;
  startsOn: string;
  endsOn: string;
  status: 'pending' | 'approved';
  typeName: string;
};

export type RosterRules = {
  loadings: Loadings;
  breakRules: BreakRule[];
  holidays: { id: string; day: string; name: string }[];
};

/**
 * What each person is paid, for costing shifts; absent for anyone without an accepted hourly
 * contract. `loadings` come from the person's award where it publishes a whole-day rate, and
 * take the place of the workspace's own loading for that kind of day.
 */
export type RosterRate = { hourly: string; loadings: Partial<Loadings> };
export type RosterRates = Record<string, RosterRate>;
