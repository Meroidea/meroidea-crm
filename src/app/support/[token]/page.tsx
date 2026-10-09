import type { Metadata } from 'next';

import { DotBackground } from '@/components/layout/dot-background';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SupportForm } from '@/modules/helpdesk/components/public-forms';
import { getPublicForm } from '@/modules/helpdesk/public';

export const metadata: Metadata = { title: 'Contact support', referrer: 'no-referrer' };

export default async function SupportPage({ params }: PageProps<'/support/[token]'>) {
  const { token } = await params;
  const form = await getPublicForm(token);
  return (
    <div className="relative isolate flex min-h-svh flex-col items-center px-4 py-10">
      <DotBackground />
      <div className="flex w-full max-w-xl flex-col gap-5">
        <Card>
          {!form ? (
            <>
              <CardHeader>
                <CardTitle>This contact form is not available</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                It may have been switched off. Contact the business another way.
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                  {form.businessName}
                </p>
                <CardTitle className="text-2xl">How can we help?</CardTitle>
              </CardHeader>
              <CardContent>
                <SupportForm token={token} />
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
