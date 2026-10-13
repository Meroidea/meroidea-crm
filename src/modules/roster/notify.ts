import { dayParts } from './hours';

export type NotifiedShift = {
  date: string;
  startTime: string;
  endTime: string;
  team: string | null;
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? '',
  );

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

  const text = [greeting, '', intro, ...lines, ...(input.message ? ['', input.message] : [])].join(
    '\n',
  );
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    lines.length ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '',
    input.message ? `<p>${escapeHtml(input.message)}</p>` : '',
  ].join('');

  return { subject: `Your roster for ${days}`, text, html };
}
