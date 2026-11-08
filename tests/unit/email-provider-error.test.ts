import { describe, expect, it } from 'vitest';

import { providerError } from '@/server/email';

const refusal = (body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 403 });

describe('email provider refusals', () => {
  it('logs the provider reason without the recipient address', async () => {
    const result = await providerError(
      refusal({
        statusCode: 403,
        name: 'validation_error',
        message: 'You can only send testing emails to your own email address (sam@example.com).',
      }),
    );
    expect(result).toEqual({
      error: 'validation_error',
      detail: 'You can only send testing emails to your own email address ([address]).',
    });
    expect(JSON.stringify(result)).not.toContain('example.com');
  });

  it('ignores a body that is not the provider error shape', async () => {
    expect(await providerError(refusal('<html>gateway</html>'))).toEqual({});
    expect(await providerError(refusal({ name: 'Not A Code!', message: 42 }))).toEqual({});
  });
});
