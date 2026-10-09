import { it } from 'vitest';
import { createSupabaseAdminClient } from '@/server/supabase/admin';
it('prints', async () => {
  const { data, error } = await createSupabaseAdminClient()
    .storage.from('documents')
    .createSignedUrl('x/y.docx', 60, { download: 'Staff Handbook (version 1).docx' });
  console.log('URL_TAIL', data?.signedUrl.replace(/token=[^&]+/, 'token=…'), error?.message);
});
