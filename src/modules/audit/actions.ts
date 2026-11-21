'use server';

import { authedAction } from '@/server/action';

import { exportAuditLog } from './export';
import { auditFiltersSchema } from './schemas';

export const exportAuditLogAction = authedAction(
  { permission: 'audit.view', input: auditFiltersSchema },
  (ctx, input) => exportAuditLog(ctx, input),
);
