import { cn } from '@/lib/utils';

/**
 * Dotted grid behind every page: the public website, sign-in, the public forms, the workspace
 * and the platform console. Fixed to the viewport so it stays put while content scrolls over
 * it, and faded towards the edges so it frames the content rather than competing with it.
 * Cards and panels keep their solid surfaces, so text never sits on the dots. Decorative only,
 * and left out of print.
 */
export function DotBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none fixed inset-0 -z-20 print:hidden', className)}
    >
      <div className="absolute inset-0 [background-image:radial-gradient(var(--dot)_1px,transparent_1px)] [background-size:20px_20px]" />
      <div className="absolute inset-0 bg-background [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]" />
    </div>
  );
}
