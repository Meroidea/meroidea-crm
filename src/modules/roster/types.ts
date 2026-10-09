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
  userId: string;
  /** The day the shift starts on. */
  date: string;
  startTime: string;
  endTime: string;
  /** True when the shift ends on the day after it starts. */
  overnight: boolean;
  breakMinutes: number;
  /** Worked time: length of the shift less the break. */
  paidMinutes: number;
  position: string | null;
  note: string | null;
};

export type RosterPerson = { userId: string; fullName: string };
