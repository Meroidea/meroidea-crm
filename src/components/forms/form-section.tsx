import { useId, type ReactNode } from 'react';

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      role="group"
      aria-labelledby={id}
      className="grid gap-4 border-t pt-6 first:border-t-0 first:pt-0 md:grid-cols-[14rem_1fr] md:gap-8"
    >
      <div>
        <h2 id={id} className="font-medium">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
