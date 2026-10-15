import type { Metadata } from 'next';

import { DotBackground } from '@/components/layout/dot-background';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { WebForm } from '@/modules/leads/components/web-form';
import { getPublicWebForm } from '@/modules/leads/public';
import { UTM_KEYS } from '@/modules/leads/schemas';

export const metadata: Metadata = {
  title: 'Get in touch',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function WebFormPage({ params, searchParams }: PageProps<'/f/[key]'>) {
  const [{ key }, query] = await Promise.all([params, searchParams]);
  const form = await getPublicWebForm(key);
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value)?.slice(0, 200) ?? '';
  const embedded = one(query.embed) === '1';
  // The campaign that brought the visitor travels with their enquiry.
  const utm = Object.fromEntries(
    UTM_KEYS.flatMap((utmKey) => (one(query[utmKey]) ? [[utmKey, one(query[utmKey])]] : [])),
  );

  return (
    <div
      className={cn(
        'relative isolate flex flex-col items-center px-4',
        embedded ? 'py-4' : 'min-h-svh py-10',
      )}
    >
      {!embedded && <DotBackground />}
      <div className="flex w-full max-w-xl flex-col gap-5">
        {!form ? (
          <Card>
            <CardHeader>
              <CardTitle>This form is not available</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              It may have been switched off. Contact the business another way.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="text-center">
              <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                {form.businessName}
              </p>
              <CardTitle role="heading" aria-level={1} className="text-2xl text-balance">
                {form.heading}
              </CardTitle>
              {form.intro && (
                <p className="text-sm whitespace-pre-line text-muted-foreground">{form.intro}</p>
              )}
            </CardHeader>
            <CardContent>
              <WebForm
                formKey={key}
                businessName={form.businessName}
                fields={form.fields}
                submitLabel={form.submitLabel}
                thankYouMessage={form.thankYouMessage}
                utm={utm}
                initiallySent={one(query.sent) === '1'}
                initiallyFailed={one(query.failed) === '1'}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
