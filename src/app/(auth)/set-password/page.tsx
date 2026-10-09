import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Card, CardContent } from '@/components/ui/card';
import { SetPasswordForm } from '@/modules/access/components/password-forms';
import { createSupabaseServerClient } from '@/server/supabase/server';

export const metadata: Metadata = { title: 'Choose a password' };

/** Reached from a password link (which signs the person in) or from "Change password". */
export default async function SetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?link=expired');

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="flex flex-col gap-6 py-8">
        <div className="space-y-1.5 text-center">
          <h1 className="text-xl font-semibold">Choose your password</h1>
          <p className="text-sm text-muted-foreground" data-sensitive>
            For {user.email}. You will use it to sign in from now on.
          </p>
        </div>
        <SetPasswordForm />
      </CardContent>
    </Card>
  );
}
