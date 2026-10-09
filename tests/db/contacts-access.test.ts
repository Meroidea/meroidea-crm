import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { getContact, listContacts } from '@/modules/contacts/queries';
import {
  checkDuplicates,
  createContact,
  deleteContact,
  updateContact,
} from '@/modules/contacts/service';
import { getOrganization } from '@/modules/organizations/queries';
import { createOrganization } from '@/modules/organizations/service';
import { linkOrganization } from '@/modules/contacts/service';
import { createContactSchema, updateContactSchema } from '@/modules/contacts/schemas';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';

import {
  addMember,
  contextFor,
  createTeam,
  createWorkspace,
  destroyWorkspace,
} from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

type People = {
  tenantId: string;
  userIds: string[];
  owner: TenantContext;
  mia: TenantContext;
  max: TenantContext;
  mona: TenantContext;
};

let alpha: People;
let beta: { tenantId: string; userIds: string[]; owner: TenantContext };

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

function newContact(fields: Record<string, unknown>) {
  return createContactSchema.parse(fields);
}

beforeAll(async () => {
  const a = await createWorkspace('Alpha Clinic', mail('alpha-owner'));
  // Mia and Max are consultants; Mona manages the team Max sits in, not Mia's.
  const monaId = await addMember(a.tenantId, mail('mona'), 'Mona Manager', 'manager');
  const teamId = await createTeam(a.tenantId, 'North', monaId);
  const miaId = await addMember(a.tenantId, mail('mia'), 'Mia Member', 'member');
  const maxId = await addMember(a.tenantId, mail('max'), 'Max Member', 'member', teamId);
  alpha = {
    tenantId: a.tenantId,
    userIds: [a.ownerId, monaId, miaId, maxId],
    owner: await contextFor(a.ownerId, a.tenantId),
    mia: await contextFor(miaId, a.tenantId),
    max: await contextFor(maxId, a.tenantId),
    mona: await contextFor(monaId, a.tenantId),
  };

  const b = await createWorkspace('Beta Freight', mail('beta-owner'));
  beta = {
    tenantId: b.tenantId,
    userIds: [b.ownerId],
    owner: await contextFor(b.ownerId, b.tenantId),
  };
}, 120_000);

afterAll(async () => {
  if (alpha) await destroyWorkspace(alpha.tenantId, alpha.userIds);
  if (beta) await destroyWorkspace(beta.tenantId, beta.userIds);
}, 60_000);

describe('contact access', () => {
  it("consultant cannot view another consultant's contact", async () => {
    const { id } = await createContact(
      alpha.max,
      newContact({ firstName: 'Priya', lastName: 'Shah' }),
    );

    const list = await listContacts(alpha.mia, {});
    expect(list.items.map((row) => row.id)).not.toContain(id);
    await expectCode(() => getContact(alpha.mia, id), 'NOT_FOUND');
  });

  it("manager sees their team's contacts but not other consultants'", async () => {
    const maxContact = await createContact(
      alpha.max,
      newContact({ firstName: 'Tomás', lastName: 'Ruiz' }),
    );
    const miaContact = await createContact(
      alpha.mia,
      newContact({ firstName: 'Ana', lastName: 'Lima' }),
    );

    const ids = (await listContacts(alpha.mona, {})).items.map((row) => row.id);
    expect(ids).toContain(maxContact.id);
    expect(ids).not.toContain(miaContact.id);
  });

  it('another workspace cannot read a contact, even by id', async () => {
    const { id } = await createContact(
      alpha.owner,
      newContact({ firstName: 'Kenji', lastName: 'Sato' }),
    );

    await expectCode(() => getContact(beta.owner, id), 'NOT_FOUND');
    expect((await listContacts(beta.owner, {})).items).toHaveLength(0);
  });

  it('refuses to update or delete a contact outside scope', async () => {
    const { id } = await createContact(
      alpha.max,
      newContact({ firstName: 'Lena', lastName: 'Berg' }),
    );

    await expectCode(
      () => updateContact(alpha.mia, updateContactSchema.parse({ id, firstName: 'Hijacked' })),
      'NOT_FOUND',
    );
    await expectCode(() => deleteContact(alpha.mia, id), 'FORBIDDEN');
  });

  it('consultant cannot hand a contact to a colleague', async () => {
    await expectCode(
      () =>
        createContact(alpha.mia, newContact({ firstName: 'Omar', ownerUserId: alpha.max.userId })),
      'FORBIDDEN',
    );
  });
});

describe('duplicate detection', () => {
  it('names the owner of an out-of-scope duplicate without revealing the record', async () => {
    await createContact(
      alpha.max,
      newContact({ firstName: 'Grace', lastName: 'Ho', email: `grace-${stamp}@example.com` }),
    );

    const matches = await checkDuplicates(alpha.mia, {
      email: `  GRACE-${stamp}@example.com `,
      dateOfBirth: null,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      matchKind: 'email',
      ownerName: 'Max Member',
      contact: null,
    });
  });

  it('matches national and international forms of the same phone', async () => {
    const { id } = await createContact(
      alpha.mia,
      newContact({ firstName: 'Ivy', phone: '0412 555 019' }),
    );

    const matches = await checkDuplicates(alpha.mia, {
      phone: '+61 412 555 019',
      dateOfBirth: null,
    });
    expect(matches[0]).toMatchObject({ matchKind: 'phone', contact: { id } });
  });

  it('warns on create, and creates once the duplicate is confirmed', async () => {
    const fields = { firstName: 'Noah', email: `noah-${stamp}@example.com` };
    await createContact(alpha.mia, newContact(fields));

    await expectCode(() => createContact(alpha.mia, newContact(fields)), 'DUPLICATE');
    const second = await createContact(
      alpha.mia,
      newContact({ ...fields, confirmDuplicate: true }),
    );
    expect(second.id).toBeTruthy();
  });

  it('never matches across workspaces', async () => {
    await createContact(
      alpha.owner,
      newContact({ firstName: 'Zed', email: `zed-${stamp}@example.com` }),
    );

    expect(
      await checkDuplicates(beta.owner, { email: `zed-${stamp}@example.com`, dateOfBirth: null }),
    ).toEqual([]);
  });
});

describe('sensitive fields and audit', () => {
  it('hides date of birth from a viewer without contacts.view_sensitive', async () => {
    const { id } = await createContact(
      alpha.owner,
      newContact({ firstName: 'Mei', dateOfBirth: '2001-04-09' }),
    );
    const restricted: TenantContext = { ...alpha.owner, grants: new Map(alpha.owner.grants) };
    restricted.grants.delete('contacts.view_sensitive');

    expect((await getContact(alpha.owner, id)).dateOfBirth).toBe('2001-04-09');
    const hidden = await getContact(restricted, id);
    expect(hidden.dateOfBirth).toBeNull();
    expect(hidden.canViewSensitive).toBe(false);
  });

  it('audits create, masked sensitive changes, owner change and soft delete', async () => {
    const { id } = await createContact(alpha.owner, newContact({ firstName: 'Ravi' }));
    await updateContact(
      alpha.owner,
      updateContactSchema.parse({
        id,
        firstName: 'Ravi',
        dateOfBirth: '1999-01-02',
        ownerUserId: alpha.mia.userId,
      }),
    );
    await deleteContact(alpha.owner, id);

    const rows = (await adminDb().execute(sql`
      select action, changes from audit_logs
      where tenant_id = ${alpha.tenantId} and entity_id = ${id} order by id`)) as unknown as {
      action: string;
      changes: Record<string, unknown> | null;
    }[];
    expect(rows.map((row) => row.action)).toEqual(['create', 'update', 'owner_change', 'delete']);
    expect(rows[1]?.changes).toEqual({ dateOfBirth: ['•••', '•••'] });
    await expectCode(() => getContact(alpha.owner, id), 'NOT_FOUND');
  });
});

describe('organizations', () => {
  it("lists only the linked people the viewer's contact scope covers", async () => {
    const org = await createOrganization(alpha.owner, {
      name: `Harbour College ${stamp}`,
      type: 'institution',
      email: null,
      phone: null,
      website: null,
      addressLine: null,
      city: null,
      region: null,
      country: null,
    });
    const mine = await createContact(alpha.mia, newContact({ firstName: 'Sofia' }));
    const theirs = await createContact(alpha.max, newContact({ firstName: 'Jonas' }));
    await linkOrganization(alpha.mia, {
      contactId: mine.id,
      organizationId: org.id,
      relationship: 'student',
    });
    await linkOrganization(alpha.max, {
      contactId: theirs.id,
      organizationId: org.id,
      relationship: 'student',
    });

    const seenByMia = await getOrganization(alpha.mia, org.id);
    expect(seenByMia.contacts.map((row) => row.contactId)).toEqual([mine.id]);
    expect(seenByMia.hiddenContactCount).toBe(1);

    await expectCode(() => getOrganization(beta.owner, org.id), 'NOT_FOUND');
  });
});
