import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { sweepAllTenants } from '@/modules/notifications/alerts';
import { serverEnv } from '@/server/env';

export const maxDuration = 60;

function authorized(header: string | null): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The scheduler's daily lead alerts (vercel.json). Only the scheduler's secret may call it. */
export async function GET(request: Request) {
  if (!authorized(request.headers.get('authorization'))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const result = await sweepAllTenants();
  return NextResponse.json({ ok: true, data: result });
}
