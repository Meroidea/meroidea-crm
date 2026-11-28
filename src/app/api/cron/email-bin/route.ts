import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { purgeExpiredEmailBin } from '@/modules/social/bin-sweep';
import { serverEnv } from '@/server/env';

export const maxDuration = 60;

function authorized(header: string | null): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The daily Bin sweep (vercel.json, ADR-093): email threads in the Bin for more than 30 days are
 * deleted for good with their files. Only the scheduler's secret may call it.
 */
export async function GET(request: Request) {
  if (!authorized(request.headers.get('authorization'))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const result = await purgeExpiredEmailBin();
  return NextResponse.json({ ok: true, data: result });
}
