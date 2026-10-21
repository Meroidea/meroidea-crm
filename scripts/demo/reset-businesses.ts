/*
 * Exports, then deletes, every business (tenant) on Meroidea, with its people's logins.
 *
 *   npx tsx --tsconfig scripts/demo/tsconfig.json scripts/demo/reset-businesses.ts \
 *     [--out /tmp/meroidea-export.json] [--only "Name A,Name B"] [--confirm "Name A,Name B"]
 *
 * Without --confirm it is a dry run: it prints what it would delete and stops. With --confirm
 * it must be given exactly the names it found, comma-separated, or it stops too. Then it:
 *   1. writes a JSON export of every row of each business (every table with a tenant_id, the
 *      tenant row, its people's `users` rows and their auth accounts' basic fields) and copies
 *      of its stored files, and reads the export back to check it;
 *   2. deletes the rows in one transaction, children before parents, with the privileged
 *      connection; the order comes from the database's own foreign keys;
 *   3. deletes the businesses' stored files through the Supabase storage API;
 *   4. deletes the logins left with no membership in any business, never a platform owner's.
 *
 * --only limits it to the named businesses (used to test it against a shared local database).
 */

import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { sql } from 'drizzle-orm';

import { adminDb } from '@/server/db/admin';
import { platformOwnerEmails } from '@/server/platform';
import { createSupabaseAdminClient } from '@/server/supabase/admin';

import { isEntry, listAuthUsers, parseArgs, runMain, splitNames } from './lib';

type Row = Record<string, unknown>;

export type ResetTenant = {
  id: string;
  name: string;
  status: string;
  members: number;
  rows: number;
  files: number;
};

export type ResetPlan = {
  tenants: ResetTenant[];
  /** Tables with a tenant_id, in the order they are deleted: children first. */
  tables: string[];
  storageObjects: { bucket: string; name: string; tenantId: string }[];
};

const run = async <T extends Row>(query: ReturnType<typeof sql>) =>
  (await adminDb().execute(query)) as unknown as T[];

/** A uuid[] literal; ids are stripped to uuid characters, so nothing else can reach the SQL. */
const uuidArray = (ids: string[]) =>
  sql.raw(`array[${ids.map((id) => `'${id.replace(/[^0-9a-f-]/gi, '')}'::uuid`).join(',')}]`);

/** Tables with a tenant_id column, from information_schema rather than a list kept by hand. */
async function tenantTables(): Promise<string[]> {
  const rows = await run<{ table_name: string }>(sql`
    select distinct c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE'
    order by c.table_name`);
  return rows.map((row) => row.table_name);
}

/**
 * Orders tables so each is deleted before any table it references: a topological sort of the
 * foreign keys between them (self-references ignored). Fails on a cycle rather than guessing.
 */
export async function deletionOrder(tables: string[]): Promise<string[]> {
  const edges = await run<{ child: string; parent: string }>(sql`
    select distinct cl.relname as child, pl.relname as parent
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_class pl on pl.oid = c.confrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and c.conrelid <> c.confrelid`);
  const set = new Set([...tables, 'tenants']);
  // parent -> children still to delete before it
  const waiting = new Map<string, Set<string>>([...set].map((table) => [table, new Set()]));
  for (const { child, parent } of edges) {
    if (set.has(child) && set.has(parent)) waiting.get(parent)?.add(child);
  }
  const order: string[] = [];
  const done = new Set<string>();
  while (done.size < set.size) {
    const ready = [...set]
      .filter((table) => !done.has(table))
      .filter((table) => [...(waiting.get(table) ?? [])].every((child) => done.has(child)))
      .sort();
    if (ready.length === 0) {
      throw new Error('The foreign keys between tenant tables form a cycle; nothing was deleted.');
    }
    for (const table of ready) {
      done.add(table);
      order.push(table);
    }
  }
  if (order.at(-1) !== 'tenants') throw new Error('tenants must be deleted last.');
  return order.filter((table) => table !== 'tenants');
}

async function privateBuckets(): Promise<string[]> {
  const rows = await run<{ id: string }>(sql`select id from storage.buckets where not public`);
  return rows.map((row) => row.id);
}

export async function planReset(options: { only?: string[] } = {}): Promise<ResetPlan> {
  const all = await run<{ id: string; name: string; status: string; members: number }>(sql`
    select t.id, t.name, t.status,
      (select count(*)::int from tenant_memberships m where m.tenant_id = t.id) as members
    from tenants t order by t.name, t.id`);
  const only = options.only ?? [];
  const missing = only.filter((name) => !all.some((tenant) => tenant.name === name));
  if (missing.length > 0) throw new Error(`No business is named: ${missing.join(', ')}`);
  const chosen = only.length > 0 ? all.filter((tenant) => only.includes(tenant.name)) : all;
  const ids = chosen.map((tenant) => tenant.id);

  const tables = await deletionOrder(await tenantTables());
  const rowCounts = new Map<string, number>(ids.map((id) => [id, 1]));
  if (ids.length > 0) {
    for (const table of tables) {
      const counts = await run<{ tenant_id: string; n: number }>(sql`
        select tenant_id, count(*)::int as n from ${sql.identifier(table)}
        where tenant_id = any(${uuidArray(ids)})
        group by tenant_id`);
      for (const { tenant_id, n } of counts) {
        rowCounts.set(tenant_id, (rowCounts.get(tenant_id) ?? 0) + n);
      }
    }
  }

  const buckets = await privateBuckets();
  const storageObjects: ResetPlan['storageObjects'] = [];
  for (const id of buckets.length > 0 ? ids : []) {
    const objects = await run<{ bucket_id: string; name: string }>(sql`
      select bucket_id, name from storage.objects
      where bucket_id in ${buckets} and name like ${`${id}/%`}
      order by bucket_id, name`);
    for (const object of objects) {
      storageObjects.push({ bucket: object.bucket_id, name: object.name, tenantId: id });
    }
  }

  return {
    tables,
    storageObjects,
    tenants: chosen.map((tenant) => ({
      ...tenant,
      rows: rowCounts.get(tenant.id) ?? 1,
      files: storageObjects.filter((object) => object.tenantId === tenant.id).length,
    })),
  };
}

/** The people tied to these businesses: members, staff with a login, agreement recipients. */
async function peopleOf(tenantIds: string[]): Promise<string[]> {
  if (tenantIds.length === 0) return [];
  const rows = await run<{ user_id: string }>(sql`
    select user_id from tenant_memberships where tenant_id = any(${uuidArray(tenantIds)})
    union select user_id from employees
      where tenant_id = any(${uuidArray(tenantIds)}) and user_id is not null
    union select recipient_user_id from tenant_agreements
      where tenant_id = any(${uuidArray(tenantIds)})`);
  return rows.map((row) => row.user_id);
}

type TenantExport = {
  tenant: Row;
  tables: Record<string, Row[]>;
  users: Row[];
  authUsers: Row[];
  storageObjects: { bucket: string; name: string; savedAs: string | null }[];
};

export type ExportFile = {
  format: 'meroidea-tenant-export/1';
  exportedAt: string;
  tenants: TenantExport[];
};

async function exportTenant(
  tenantId: string,
  tables: string[],
  objects: ResetPlan['storageObjects'],
  filesDir: string,
): Promise<TenantExport> {
  // Postgres writes each row as JSON itself, so types (timestamps, numerics, arrays) are exact.
  const json = async (query: ReturnType<typeof sql>) =>
    ((await run<{ rows: Row[] }>(query))[0]?.rows ?? []) as Row[];
  const [tenant] = await json(
    sql`select coalesce(json_agg(t), '[]') as rows from tenants t where t.id = ${tenantId}`,
  );
  const data: Record<string, Row[]> = {};
  for (const table of tables) {
    const rows = await json(sql`
      select coalesce(json_agg(t), '[]') as rows from ${sql.identifier(table)} t
      where t.tenant_id = ${tenantId}`);
    if (rows.length > 0) data[table] = rows;
  }
  const people = await peopleOf([tenantId]);
  const users =
    people.length > 0
      ? await json(sql`select coalesce(json_agg(u), '[]') as rows from users u
          where u.id = any(${uuidArray(people)})`)
      : [];
  // Who each login was, never its password hash or tokens.
  const authUsers =
    people.length > 0
      ? await json(sql`select coalesce(json_agg(a), '[]') as rows from (
          select id, email, email_confirmed_at, created_at, last_sign_in_at, raw_user_meta_data
          from auth.users where id = any(${uuidArray(people)})) a`)
      : [];

  const storage = createSupabaseAdminClient().storage;
  const storageObjects: TenantExport['storageObjects'] = [];
  for (const object of objects.filter((candidate) => candidate.tenantId === tenantId)) {
    const { data: blob, error } = await storage.from(object.bucket).download(object.name);
    if (error || !blob) throw new Error(`Could not copy a stored file of ${tenantId}.`);
    const savedAs = join(object.bucket, object.name);
    const target = join(filesDir, savedAs);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(await blob.arrayBuffer()), { mode: 0o600 });
    storageObjects.push({ bucket: object.bucket, name: object.name, savedAs });
  }

  return { tenant: tenant ?? {}, tables: data, users, authUsers, storageObjects };
}

/** Reads the written export back and checks it holds every row and file counted in the plan. */
function verifyExport(path: string, plan: ResetPlan, filesDir: string): void {
  if (!statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error('The export file is empty.');
  }
  const written = JSON.parse(readFileSync(path, 'utf8')) as ExportFile;
  for (const tenant of plan.tenants) {
    const entry = written.tenants.find((candidate) => candidate.tenant.id === tenant.id);
    if (!entry) throw new Error(`The export is missing ${tenant.name}.`);
    const rows =
      1 + Object.values(entry.tables).reduce((sum, tableRows) => sum + tableRows.length, 0);
    if (rows !== tenant.rows) {
      throw new Error(`The export of ${tenant.name} has ${rows} rows, expected ${tenant.rows}.`);
    }
    for (const object of entry.storageObjects) {
      if (!object.savedAs || !statSync(join(filesDir, object.savedAs)).isFile()) {
        throw new Error(`A stored file of ${tenant.name} was not copied.`);
      }
    }
    if (entry.storageObjects.length !== tenant.files) {
      throw new Error(`The export of ${tenant.name} is missing stored files.`);
    }
  }
}

export type ResetResult =
  | { done: false; reason: 'dry_run' | 'confirm_mismatch' | 'nothing_to_delete'; plan: ResetPlan }
  | {
      done: true;
      plan: ResetPlan;
      exportPath: string;
      filesDir: string;
      deletedRows: number;
      deletedFiles: number;
      deletedLogins: number;
      keptLogins: number;
      loginFailures: number;
    };

export async function resetBusinesses(options: {
  out: string;
  confirm?: string[];
  only?: string[];
  log?: (line: string) => void;
}): Promise<ResetResult> {
  const log = options.log ?? (() => {});
  const plan = await planReset({ only: options.only });

  log(`Found ${plan.tenants.length} business(es):`);
  for (const tenant of plan.tenants) {
    log(
      `  - ${tenant.name} [${tenant.status}] ${tenant.id}: ${tenant.rows} rows, ` +
        `${tenant.members} memberships, ${tenant.files} stored files`,
    );
  }
  if (plan.tenants.length === 0) return { done: false, reason: 'nothing_to_delete', plan };

  const found = plan.tenants.map((tenant) => tenant.name);
  if (!options.confirm) {
    log('\nDry run: nothing was exported or deleted. To delete exactly these, re-run with:');
    log(`  --confirm "${found.join(',')}"`);
    return { done: false, reason: 'dry_run', plan };
  }
  const same = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().every((name, index) => name === [...b].sort()[index]);
  if (found.some((name) => name.includes(',')) || !same(options.confirm, found)) {
    log('\n--confirm does not match the businesses found. Nothing was exported or deleted.');
    return { done: false, reason: 'confirm_mismatch', plan };
  }

  const owners = platformOwnerEmails();
  if (owners.length === 0) {
    throw new Error('PLATFORM_ADMIN_EMAILS is empty; refusing to delete logins without it.');
  }

  // 1. Export, and check it, before anything is deleted.
  const filesDir = `${options.out}.files`;
  mkdirSync(dirname(options.out), { recursive: true });
  mkdirSync(filesDir, { recursive: true, mode: 0o700 });
  const exported: ExportFile = {
    format: 'meroidea-tenant-export/1',
    exportedAt: new Date().toISOString(),
    tenants: [],
  };
  for (const tenant of plan.tenants) {
    exported.tenants.push(
      await exportTenant(tenant.id, plan.tables, plan.storageObjects, filesDir),
    );
  }
  writeFileSync(options.out, JSON.stringify(exported, null, 2), { mode: 0o600 });
  chmodSync(options.out, 0o600);
  verifyExport(options.out, plan, filesDir);
  log(`\nExport written and checked: ${options.out} (stored files under ${filesDir})`);

  // 2. Rows, in one transaction.
  const ids = plan.tenants.map((tenant) => tenant.id);
  const people = await peopleOf(ids);
  const deletedRows = await adminDb().transaction(async (tx) => {
    let total = 0;
    for (const table of [...plan.tables, 'tenants']) {
      const column = table === 'tenants' ? 'id' : 'tenant_id';
      const deleted = (await tx.execute(sql`
        delete from ${sql.identifier(table)} where ${sql.identifier(column)} = any(${uuidArray(ids)})
        returning 1`)) as unknown as unknown[];
      total += deleted.length;
    }
    return total;
  });
  log(`Deleted ${deletedRows} rows in one transaction.`);

  // 3. Stored files.
  const storage = createSupabaseAdminClient().storage;
  let deletedFiles = 0;
  for (const bucket of new Set(plan.storageObjects.map((object) => object.bucket))) {
    const names = plan.storageObjects
      .filter((object) => object.bucket === bucket)
      .map((o) => o.name);
    for (let start = 0; start < names.length; start += 100) {
      const { data, error } = await storage.from(bucket).remove(names.slice(start, start + 100));
      if (error) log(`  Could not delete some stored files in ${bucket}: ${error.message}`);
      deletedFiles += data?.length ?? 0;
    }
  }
  log(`Deleted ${deletedFiles} of ${plan.storageObjects.length} stored files.`);

  // 4. Logins left with no membership anywhere. With --only, just these businesses' people.
  const members = new Set(
    (await run<{ user_id: string }>(sql`select distinct user_id from tenant_memberships`)).map(
      (row) => row.user_id,
    ),
  );
  const candidates = options.only?.length ? new Set(people) : null;
  let deletedLogins = 0;
  let keptLogins = 0;
  let loginFailures = 0;
  const supabase = createSupabaseAdminClient();
  for (const user of await listAuthUsers()) {
    if (members.has(user.id)) continue;
    if (candidates && !candidates.has(user.id)) continue;
    if (user.email && owners.includes(user.email)) {
      keptLogins += 1;
      continue;
    }
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) loginFailures += 1;
    else deletedLogins += 1;
  }
  log(
    `Deleted ${deletedLogins} logins with no membership; kept ${keptLogins} platform owner login(s)` +
      (loginFailures ? `; ${loginFailures} could not be deleted (still referenced).` : '.'),
  );

  return {
    done: true,
    plan,
    exportPath: options.out,
    filesDir,
    deletedRows,
    deletedFiles,
    deletedLogins,
    keptLogins,
    loginFailures,
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const out =
    typeof args.get('out') === 'string'
      ? (args.get('out') as string)
      : `/tmp/meroidea-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const confirm = args.has('confirm') ? splitNames(args.get('confirm')) : undefined;
  const result = await resetBusinesses({
    out,
    confirm,
    only: splitNames(args.get('only')),
    log: (line) => console.log(line),
  });
  return result.done || result.reason !== 'confirm_mismatch' ? 0 : 2;
}

if (isEntry('reset-businesses.ts')) runMain(main);
