import { sql } from 'drizzle-orm';

import { FEATURE_KEYS } from '@/lib/features';
import { provisionTenant } from '@/modules/tenants/provision';
import { loadTenantContext, type TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { createSupabaseAdminClient } from '@/server/supabase/admin';

const supabase = createSupabaseAdminClient();

export async function createAuthUser(email: string, fullName: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'correct-horse-staple-42',
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) throw error ?? new Error('no user created');
  return data.user.id;
}

export async function createWorkspace(company: string, ownerEmail: string) {
  const ownerId = await createAuthUser(ownerEmail, `${company} Owner`);
  // Test businesses get every feature unless a test is about switching them.
  const { tenantId } = await provisionTenant({
    userId: ownerId,
    companyName: company,
    features: [...FEATURE_KEYS],
  });
  return { tenantId, ownerId };
}

/** Adds an active member with a default role, optionally in a specific team. */
export async function addMember(
  tenantId: string,
  email: string,
  fullName: string,
  roleKey: 'manager' | 'member' | 'support',
  teamId?: string,
): Promise<string> {
  const userId = await createAuthUser(email, fullName);
  await adminDb().execute(sql`
    insert into tenant_memberships (tenant_id, user_id, role_id, team_id, status)
    select ${tenantId}, ${userId}, r.id, ${teamId ?? null}, 'active'
    from roles r where r.tenant_id = ${tenantId} and r.key = ${roleKey}`);
  return userId;
}

export async function createTeam(tenantId: string, name: string, managerUserId: string | null) {
  const rows = (await adminDb().execute(sql`
    insert into teams (tenant_id, name, manager_user_id)
    values (${tenantId}, ${name}, ${managerUserId}) returning id`)) as unknown as { id: string }[];
  const id = rows[0]?.id;
  if (!id) throw new Error('no team created');
  return id;
}

export async function contextFor(userId: string, tenantId: string): Promise<TenantContext> {
  const ctx = await loadTenantContext({ sub: userId, role: 'authenticated' }, tenantId);
  if (!ctx) throw new Error('no context for that user');
  return ctx;
}

/** Removes a test workspace and its people, children first. */
export async function destroyWorkspace(tenantId: string, userIds: string[]): Promise<void> {
  const db = adminDb();
  for (const table of [
    'ticket_messages',
    'tickets',
    'customer_reviews',
    'review_links',
    'task_time_logs',
    'project_tasks',
    'projects',
    'applicant_notes',
    'job_applicants',
    'job_openings',
    'expense_claims',
    'time_entries',
    'leave_requests',
    'leave_types',
    'library_document_versions',
    'library_documents',
    'payslips',
    'invoice_lines',
    'invoices',
    'purchase_order_lines',
    'purchase_orders',
    'supplier_items',
    'suppliers',
    'inventory_movements',
    'inventory_items',
    'inventory_categories',
    'employee_payroll_details',
    'employment_contracts',
    'employees',
    'departments',
    'roster_shifts',
    'rosters',
    'activities',
    'tasks',
    'stage_history',
    'opportunities',
    'partners',
    'pipeline_stages',
    'pipelines',
    'lost_reasons',
    'contact_organizations',
    'contacts',
    'organizations',
    'lead_sources',
    'audit_logs',
    'tenant_subscriptions',
    'tenant_memberships',
    'role_permissions',
    'roles',
    'teams',
  ]) {
    await db.execute(sql`delete from ${sql.identifier(table)} where tenant_id = ${tenantId}`);
  }
  await db.execute(sql`delete from helpdesk_forms where tenant_id = ${tenantId}`);
  await db.execute(sql`delete from tenants where id = ${tenantId}`);
  for (const userId of userIds) await supabase.auth.admin.deleteUser(userId);
}
