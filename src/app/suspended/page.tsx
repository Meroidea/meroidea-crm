import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Workspace suspended' };

export default function SuspendedPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="max-w-md rounded-xl border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold">This workspace is suspended</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your records are safe, but nobody can sign in to this workspace for now. Please contact
          Meroidea to have it reactivated.
        </p>
      </div>
    </div>
  );
}
