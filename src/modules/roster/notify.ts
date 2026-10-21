import { renderEmail } from '@/server/email-template';
import { dayParts } from './hours';

export type NotifiedShift = {
  date: string;
  startTime: string;
  endTime: string;
  team: string | null;
};

const period = (startsOn: string, endsOn: string) =>
  `${dayParts(startsOn).day} to ${dayParts(endsOn).day}`;

/** The email one person gets when their roster is published: their own shifts and nothing else. */
export function rosterEmail(input: {
  workspace: string;
  fullName: string;
  startsOn: string;
  endsOn: string;
  shifts: NotifiedShift[];
  message: string | null;
  /** The business's own colour, when it has one. */
  color?: string | null;
}): { subject: string; text: string; html: string } {
  const days = period(input.startsOn, input.endsOn);
  const lines = input.shifts.map((shift) => {
    const { weekday, day } = dayParts(shift.date);
    return `${weekday} ${day}: ${shift.startTime} to ${shift.endTime}${shift.team ? ` (${shift.team})` : ''}`;
  });
  const intro = lines.length
    ? `Your shifts at ${input.workspace} for ${days}:`
    : `You have no shifts at ${input.workspace} for ${days}.`;
  const greeting = `Hi ${input.fullName.split(' ')[0] ?? input.fullName},`;

  const email = renderEmail({
    sender: { kind: 'business', name: input.workspace, color: input.color },
    preheader: lines.length
      ? `${lines.length} ${lines.length === 1 ? 'shift' : 'shifts'} for ${days}.`
      : `No shifts for ${days}.`,
    heading: `Your roster for ${days}`,
    blocks: [
      { type: 'paragraph', text: greeting },
      { type: 'paragraph', text: intro },
      ...(lines.length ? [{ type: 'list' as const, items: lines }] : []),
      ...(input.message ? [{ type: 'message' as const, text: input.message }] : []),
    ],
    reason: `You received this because ${input.workspace} published a roster that includes you.`,
  });
  return { subject: `Your roster for ${days}`, ...email };
}
