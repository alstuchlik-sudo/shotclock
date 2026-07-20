// SHOT-22: User connects a cTrader account via the local MCP integration
// Requires the app running against a REAL, authenticated cTrader Desktop
// MCP server (CTRADER_MCP_URL reachable, DEMO_MODE=false). The failure
// path (AC2) is covered separately in connect-failure.spec.js, which
// requires the server started with an unreachable CTRADER_MCP_URL instead.
const { test, expect } = require('@playwright/test');
const db = require('./helpers/db');

test.describe.serial('SHOT-22: Connect account', () => {
  // TC-04 (defect probe): public/js/main.js fires the abandonment beacon on
  // the browser's 'pagehide' event, which fires on ANY navigation away from
  // the page, including a same-page reload, not only when the user truly
  // leaves the flow. A single reload of /connect logs the pending attempt
  // as a drop-off ('abandoned') even though the user never left the screen.
  // This silently inflates the drop-off count and understates the real
  // activation rate the 80% target is measured against. If this is fixed
  // (e.g. by only arming the beacon after a real navigation-away, or by
  // clearing the resolved flag on reload), this assertion should flip.
  test('TC-04 (defect probe): reloading the connect screen logs a false drop-off', async ({ page }) => {
    await page.goto('/connect');
    await page.reload();

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');
    const decoded = decodeURIComponent(sessionCookie.value);
    const sessionId = decoded.slice(2, decoded.lastIndexOf('.'));

    const latest = await db.findLatestBySession(sessionId);
    expect(latest[0]?.outcome).toBe('drop_off');
    expect(latest[0]?.errorReason).toBe('abandoned');
  });

  // TC-05: Visiting the success page without ever completing a connection
  // must redirect back to /connect, not show a connected state.
  test('TC-05: success page redirects to /connect without a prior connection', async ({ page }) => {
    await page.goto('/connect/success');
    await expect(page).toHaveURL(/\/connect$/);
    await expect(page.locator('h1')).toHaveText('Connect your cTrader account');
  });

  // TC-01 (AC1): Submitting a valid connection links the account and logs
  // the attempt as complete.
  test('TC-01: happy path links the account and shows real account details', async ({ page }) => {
    const beforeConnected = await db.countByOutcome('connected');

    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();

    await expect(page).toHaveURL(/\/connect\/success$/);
    await expect(page.locator('.badge-success')).toHaveText('Connected');
    await expect(page.locator('.account-details')).toContainText('Broker');
    await expect(page.locator('.account-details dd').first()).not.toHaveText('—');

    const afterConnected = await db.countByOutcome('connected');
    expect(afterConnected).toBe(beforeConnected + 1);
  });

  // TC-08: Firing the abandonment beacon after a successful connection
  // must not flip that already-resolved record to drop-off.
  test('TC-08: abandon signal after success does not corrupt the connected record', async ({ page, request }) => {
    const beforeConnected = await db.countByOutcome('connected');

    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    // Same session cookie jar as the page, mirroring what the client's own
    // sendBeacon would send if it fired after the form already resolved.
    await request.post('/connect/abandon');

    const afterConnected = await db.countByOutcome('connected');
    expect(afterConnected).toBe(beforeConnected + 1); // unchanged by the abandon call
  });

  // TC-03 (AC3): Leaving the connect screen without submitting must log a
  // drop-off. Exercised through the real client-side beacon (public/js/main.js),
  // not by calling the endpoint directly, to prove the actual shipped script works.
  test('TC-03: leaving without submitting logs a drop-off via the real beacon script', async ({ context }) => {
    const beforeDropOff = await db.countByOutcome('drop_off');

    const page = await context.newPage();
    await page.goto('/connect');
    // Triggers 'pagehide' in the browser, which runs public/js/main.js's
    // real sendBeacon call since the form was never submitted.
    await page.goto('about:blank');
    await page.waitForTimeout(300); // let the beacon request land server-side

    const afterDropOff = await db.countByOutcome('drop_off');
    expect(afterDropOff).toBe(beforeDropOff + 1);
  });

  // TC-07: Defect probe. Submitting POST /connect with no prior GET /connect
  // (no session.attemptId) still links the account, but the guarded logging
  // (`if (attemptId) { ... }`) silently skips writing any attempt record.
  // AC1 says "the connection event is logged as complete" unconditionally,
  // this is a real gap between the ticket and the implementation.
  test('TC-07 (defect probe): connecting without a prior GET /connect skips logging', async ({ request }) => {
    const beforeConnected = await db.countByOutcome('connected');
    const beforeDropOff = await db.countByOutcome('drop_off');

    const res = await request.post('/connect', { maxRedirects: 0 });
    expect([302, 303]).toContain(res.status());
    expect(res.headers()['location']).toBe('/connect/success');

    const afterConnected = await db.countByOutcome('connected');
    const afterDropOff = await db.countByOutcome('drop_off');
    // This assertion documents the current (buggy) behavior: no log entry
    // is written even though the account was linked. If SHOT-22 is fixed to
    // always log, this test should start failing and can be flipped.
    expect(afterConnected).toBe(beforeConnected);
    expect(afterDropOff).toBe(beforeDropOff);
  });

  test('TC-06: unknown route renders the 404 page', async ({ page }) => {
    const res = await page.goto('/nonexistent-page');
    expect(res.status()).toBe(404);
    await expect(page.locator('h1')).toHaveText('Page not found');
  });

  // TC-09: Stats page math must reconcile with the underlying log, this
  // is the mechanism the strategy's 80% activation target depends on.
  test('TC-09: stats page reflects the accumulated connected/drop-off counts', async ({ page }) => {
    const connected = await db.countByOutcome('connected');
    const dropOff = await db.countByOutcome('drop_off');
    const expectedRate = Math.round((connected / (connected + dropOff)) * 100);

    await page.goto('/connect/stats');
    await expect(page.locator('.stat-value').nth(0)).toHaveText(String(connected));
    await expect(page.locator('.stat-value').nth(1)).toHaveText(String(dropOff));
    await expect(page.locator('.stat-value').nth(2)).toHaveText(`${expectedRate}%`);
  });
});
