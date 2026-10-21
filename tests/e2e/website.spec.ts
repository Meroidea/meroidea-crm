import { expect, test } from '@playwright/test';

test('a business gets in touch through the contact form', async ({ page }, testInfo) => {
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.getByRole('link', { name: 'Talk to us' }).first().click();
  await expect(page).toHaveURL(/#contact$/);
  const form = page.locator('#contact');
  await expect(form.getByRole('heading', { level: 2 })).toBeVisible();

  await form.getByLabel('Your name').fill('Jordan Lee');
  await form.getByLabel('Business name').fill(`Corner Grocer ${stamp}`);
  await form.getByLabel('Work email').fill(`jordan-${stamp}@example.com`);
  await form.getByLabel('Team size').selectOption('2–10');
  await form
    .getByLabel('How can we help?')
    .fill('We want rosters, stock and supplier orders in one place.');
  await form.getByRole('button', { name: 'Send message' }).click();

  await expect(form.getByRole('status')).toContainText('Thanks, Jordan!', { timeout: 20_000 });
});

test('the contact form explains what is missing', async ({ page }) => {
  await page.goto('/#contact');
  await page.waitForLoadState('networkidle');
  const form = page.locator('#contact');
  await form.getByRole('button', { name: 'Send message' }).click();
  await expect(form.getByText('Tell us your name')).toBeVisible();
  await expect(form.getByText('Enter a valid email address')).toBeVisible();
});

test('the site has its icon, share card and app manifest', async ({ page, request }) => {
  await page.goto('/');
  const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(ogImage).toMatch(/\/opengraph-image/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    'content',
    'summary_large_image',
  );
  await expect(page).toHaveTitle(/Meroidea/);

  for (const [path, type] of [
    [new URL(ogImage!).pathname, 'image/png'],
    ['/icon.svg', 'image/svg+xml'],
    ['/apple-icon.png', 'image/png'],
    ['/favicon.ico', 'image/'],
    ['/manifest.webmanifest', 'application/manifest+json'],
  ] as const) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toContain(type);
  }
});
