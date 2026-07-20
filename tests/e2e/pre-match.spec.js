// SHOT-23: System sends Pre-Match at a fixed local morning time.
//
// Scoped down from the literal AC: SHOT-23 describes an autonomous,
// per-timezone-clock-triggered send. That needs a persistent Account model
// and Vercel Cron, neither of which exist yet. This implements the same
// "Pre-Match is generated and sent" outcome via an explicit user action
// (a "Get my Pre-Match report" CTA with a timezone picker) instead of a
// background scheduler. AC3 (no send for unconnected users) is the one
// piece of the original AC that carries over exactly, it's tested directly.
const { test, expect } = require('@playwright/test');
const db = require('./helpers/db');

test.describe.serial('SHOT-23: Pre-Match report', () => {
  // TC-10: mirrors TC-05's access-gating pattern for the connect flow.
  test('TC-10: GET /pre-match redirects to /connect without a prior connection', async ({ page }) => {
    await page.goto('/pre-match');
    await expect(page).toHaveURL(/\/connect$/);
  });

  // TC-13 (AC3): the one piece of the original acceptance criteria that
  // carries over unchanged, no report can be generated for an account that
  // was never connected. Bare POST, no session, mirrors TC-07's approach.
  test('TC-13 (AC3): POST /pre-match without a connected session is blocked', async ({ request }) => {
    const before = await db.countPreMatchSends();

    const res = await request.post('/pre-match', { form: { timezone: 'UTC' }, maxRedirects: 0 });
    expect([302, 303]).toContain(res.status());
    expect(res.headers()['location']).toBe('/connect');

    const after = await db.countPreMatchSends();
    expect(after).toBe(before);
  });

  // TC-11 (AC1, on-demand form): happy path, connect first, then generate
  // a report for a chosen timezone.
  test('TC-11: connected user generates a Pre-Match report for their timezone', async ({ page }) => {
    const before = await db.countPreMatchSends();

    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    await page.getByRole('link', { name: 'Get my Pre-Match report' }).click();
    await expect(page).toHaveURL(/\/pre-match$/);

    await page.selectOption('select[name="timezone"]', 'America/New_York');
    await page.getByRole('button', { name: 'Get my Pre-Match report' }).click();

    await expect(page.locator('.account-details')).toContainText('America/New_York');
    await expect(page.locator('.account-details')).toContainText('Broker');

    const after = await db.countPreMatchSends();
    expect(after).toBe(before + 1);
  });

  // TC-12: the <select required> attribute blocks empty submission in a
  // real browser, but the server must independently reject a missing or
  // invalid timezone value, since a bare POST bypasses HTML validation
  // entirely, same reasoning as TC-13's use of request over page actions.
  test('TC-12: server rejects a missing timezone even without client-side validation', async ({ page, request }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');

    const before = await db.countPreMatchSends();
    const res = await request.post('/pre-match', {
      form: { timezone: 'Not/ARealZone' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('Choose a valid timezone');

    const after = await db.countPreMatchSends();
    expect(after).toBe(before);
  });
});
