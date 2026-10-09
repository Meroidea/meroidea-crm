import type { Metadata } from 'next';

import { DotBackground } from '@/components/layout/dot-background';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReviewForm } from '@/modules/reviews/components/review-form';
import { getPublicReviewLink } from '@/modules/reviews/public';

export const metadata: Metadata = {
  title: 'Leave a review',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function ReviewPage({ params }: PageProps<'/r/[token]'>) {
  const { token } = await params;
  const link = await getPublicReviewLink(token);

  return (
    <div className="relative isolate flex min-h-svh flex-col items-center px-4 py-10">
      <DotBackground />
      <div className="flex w-full max-w-md flex-col gap-5">
        {!link ? (
          <Card>
            <CardHeader>
              <CardTitle>This review page is not available</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              The link may have been switched off. Ask the business for their current one.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="text-center">
              <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                {link.businessName}
              </p>
              <CardTitle className="text-2xl text-balance">{link.prompt}</CardTitle>
            </CardHeader>
            <CardContent>
              <ReviewForm token={token} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
