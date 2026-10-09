import type { Metadata } from 'next';

import { Card, CardContent } from '@/components/ui/card';
import { ForgotPasswordForm } from '@/modules/access/components/password-forms';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardContent className="flex flex-col gap-6 py-8">
        <div className="space-y-1.5 text-center">
          <h1 className="text-xl font-semibold">Forgot your password?</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we’ll send a link to choose a new one.
          </p>
        </div>
        <ForgotPasswordForm />
      </CardContent>
    </Card>
  );
}
