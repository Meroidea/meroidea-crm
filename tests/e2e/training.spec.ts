import { expect, test } from '@playwright/test';

import { addPerson, onboardBusiness, signInAs } from './support/flows';

test('the admin writes a course for staff, and a staff member completes it', async ({
  page,
  context,
  browser,
}, testInfo) => {
  // Onboards a business, writes a course, adds a person and signs in as them.
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  await onboardBusiness(page, context, stamp);
  const staffLink = await addPerson(page, 'Casey Crew', `casey-${stamp}@example.com`, 'Staff');

  // The admin writes a course with one module and a one-question quiz (ADR-050).
  await page.goto('/training/manage');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Course title').fill('Cash handling');
  await page.getByRole('button', { name: 'Create course' }).click();
  await expect(page).toHaveURL(/\/training\/manage\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const courseUrl = page.url();

  await page.getByRole('link', { name: 'Add module' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Module title').fill('Counting the till');
  await page
    .getByLabel('Content')
    .fill('## At close\n\nCount the till with a second person.\n\n- Note any difference');
  await page.getByRole('button', { name: 'Add a question' }).click();
  await page.getByLabel('Question 1', { exact: true }).fill('Who counts the till with you?');
  await page.getByLabel('Question 1, answer 1').fill('Nobody');
  await page.getByLabel('Question 1, answer 2').fill('A second person');
  await page.getByLabel('Answer 2 is the right one').check();
  await page.getByRole('button', { name: 'Add module' }).click();
  await expect(page).toHaveURL(courseUrl, { timeout: 30_000 });
  await expect(page.getByText('1 quiz question')).toBeVisible();

  // Only staff do it, and only once it is published.
  await page.getByLabel('Assign to').selectOption({ label: 'Everyone with a role' });
  await page.getByLabel('Who').selectOption({ label: 'Staff' });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByText('Role: Staff')).toBeVisible();
  await page.getByRole('button', { name: 'Publish to assigned staff' }).click();
  await expect(
    page.getByText('Staff it is assigned to can see and complete it now.'),
  ).toBeVisible();

  // The staff member sees it, gets it wrong, then passes.
  const staff = await signInAs(browser, staffLink, 'casey-crew-password-1');
  await staff.page.goto('/training');
  await expect(staff.page.getByRole('img', { name: 'All training completed: 0%' })).toBeVisible();
  await staff.page.getByRole('link', { name: 'Counting the till' }).click();
  await staff.page.waitForLoadState('networkidle');
  await expect(staff.page.getByRole('heading', { name: 'At close' })).toBeVisible();
  await staff.page.getByLabel('Nobody').check();
  await staff.page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(staff.page.getByText('0%: you need 80% to pass.')).toBeVisible();
  await staff.page.getByRole('button', { name: 'Try again' }).click();
  await staff.page.getByLabel('A second person').check();
  await staff.page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(staff.page.getByText('Passed with 100%.')).toBeVisible();
  await staff.page.getByRole('link', { name: 'Back to my training' }).click();
  await expect(staff.page.getByRole('img', { name: 'All training completed: 100%' })).toBeVisible();

  // The admin sees it on the staff grid, and in the person's detail.
  await page.goto('/training/team');
  await expect(
    page.getByRole('img', { name: "Casey Crew's training completed: 100%" }),
  ).toBeVisible();
  await page.getByRole('link', { name: /Casey Crew/ }).click();
  await expect(page.getByRole('heading', { name: 'Individual performance' })).toBeVisible();
  await expect(page.getByText('Passed', { exact: true })).toBeVisible();

  await staff.context.close();
});
