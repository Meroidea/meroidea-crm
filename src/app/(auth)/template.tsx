import type { ReactNode } from 'react';

/**
 * Re-mounted on every navigation, so each page plays its short entrance (globals.css). A full-width
 * column, so the centred card inside keeps its width in the auth layout's flex column.
 */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter flex w-full flex-col items-center">{children}</div>;
}
