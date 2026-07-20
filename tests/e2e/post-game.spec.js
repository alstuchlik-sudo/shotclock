// SHOT-29: System detects end-of-trading-day and sends Post-Game.
//
// Scoped down the same way SHOT-23 scoped Pre-Match, and per explicit
// product direction for this story: the literal AC describes the system
// autonomously detecting each connected account's local 8pm and firing
// Post-Game on its own, which needs a persistent Account model plus a
// scheduler (Vercel Cron) polling every connected account's timezone,
// neither of which exist. This instead mirrors Pre-Match's on-demand model
// exactly, a "Get my Post-Game recap" CTA the user taps themselves, for demo
// purposes, with no real gating on whether it's actually past 8pm. AC2
// (each account gets its own local time, not one shared UTC time) is still
// demonstrated, just manually: generating two recaps with two different
// timezones selected produces two different localTimeAtSend values, using
// the same per-timezone-aware formatting Pre-Match already has coverage for.
//
// Reuses the same demo-mode-only ?scenario=... test hooks as
// pre-match.spec.js (see routes/postgame.js), for the same reason: the real
// account's live state can't be forced into these cases deterministically.
const { test, expect } = require('@playwright/test');
const db = require('./helpers/db');

test.describe.serial('SHOT-29: Post-Game recap', () => {
  test('TC-01: GET /post-game redirects to /connect without a prior connection', async ({ page }) => {
    await page.goto('/post-game');
    await expect(page).toHaveURL(/\/connect$/);
  });

  test('TC-02: POST /post-game without a connected session is blocked', async ({ request }) => {
    const before = await db.countPostGameSends();

    const res = await request.post('/post-game', { form: { timezone: 'Europe/London' }, maxRedirects: 0 });
    expect([302, 303]).toContain(res.status());
    expect(res.headers()['location']).toBe('/connect');

    const after = await db.countPostGameSends();
    expect(after).toBe(before);
  });

  // TC-03 (AC1): a connected user taps the CTA and gets a recap with the
  // evening narration tone, tagged with the post-game-v1 template (not
  // pre-match-v1), stating the correct box score values with no invented
  // numbers, same guarantee as Pre-Match's narration (SHOT-26).
  //
  // Also covers SHOT-30 AC1+AC2 in one pass: the default demo order history
  // (services/ctraderMcp.js getMockOrderHistory) has one trade closed today
  // and one closed two days ago, so this single recap generation proves
  // both "today's trade is included" and "the previous day's trade is
  // excluded" from the same dataset.
  test('TC-03 (AC1): connected user generates a Post-Game recap with the evening narration and box score', async ({
    page,
  }) => {
    const before = await db.countPostGameSends();

    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    await page.getByRole('link', { name: 'Get my Post-Game recap' }).click();
    await expect(page).toHaveURL(/\/post-game$/);

    await page.selectOption('select[name="timezone"]', 'America/New_York');
    await page.getByRole('button', { name: 'Get my Post-Game recap' }).click();

    await expect(page.locator('.account-details')).toContainText('America/New_York');
    await expect(page.locator('.account-details')).toContainText('Broker');
    await expect(page.locator('.positions-table')).toContainText('EURUSD');
    await expect(page.locator('.stats-grid')).toContainText('24s');
    await expect(page.locator('.badge-success')).toContainText('Clean');
    await expect(page.locator('.alert-error')).toHaveCount(0);

    const narration = page.locator('.narration');
    await expect(narration).toHaveAttribute('data-template-id', 'post-game-v1');
    await expect(narration).toContainText('Final buzzer');
    await expect(narration).toContainText('24 seconds');
    await expect(narration).toContainText('No fouls on the day');
    await expect(narration).toContainText('0.1 lots');
    await expect(narration).toContainText('down 15');

    // SHOT-30 AC1: today's EURUSD trade (profit -30) is included.
    // SHOT-30 AC2: the two-days-ago GBPUSD trade (profit 22.5) is excluded,
    // both from the count and from the realized-profit sum.
    const tradesTable = page.locator('.trades-table');
    await expect(tradesTable).toContainText('EURUSD');
    await expect(tradesTable).not.toContainText('GBPUSD');
    await expect(page.locator('main')).toContainText('1 trade closed today');
    await expect(page.locator('main')).toContainText('-30');

    const after = await db.countPostGameSends();
    expect(after).toBe(before + 1);

    const stored = await db.findPostGameSendsBySession(await sessionIdFromPage(page));
    const latest = stored[stored.length - 1];
    expect(latest.tradesCount).toBe(1);
    expect(latest.tradesRealizedProfit).toBe(-30);
  });

  // TC-04 (AC2): with no real scheduler, this is demonstrated rather than
  // automated: two recaps generated with two different timezones each carry
  // their own local time, not a single shared one.
  test('TC-04 (AC2): recaps generated with different timezones each carry their own local time', async ({
    page,
  }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    await page.goto('/post-game');
    await page.selectOption('select[name="timezone"]', 'Europe/London');
    await page.getByRole('button', { name: 'Get my Post-Game recap' }).click();
    await expect(page.locator('.account-details')).toContainText('Europe/London');

    await page.goto('/post-game');
    await page.selectOption('select[name="timezone"]', 'Asia/Tokyo');
    await page.getByRole('button', { name: 'Get my Post-Game recap' }).click();
    await expect(page.locator('.account-details')).toContainText('Asia/Tokyo');

    const sends = await db.findPostGameSendsBySession(await sessionIdFromPage(page));
    expect(sends.length).toBeGreaterThanOrEqual(2);
    const timezones = sends.map((s) => s.timezone);
    expect(timezones).toContain('Europe/London');
    expect(timezones).toContain('Asia/Tokyo');
    const londonSend = sends.find((s) => s.timezone === 'Europe/London');
    const tokyoSend = sends.find((s) => s.timezone === 'Asia/Tokyo');
    expect(londonSend.localTimeAtSend).not.toBe(tokyoSend.localTimeAtSend);
  });

  test('TC-05 (AC1): zero open positions shows the empty state and a valid zero-exposure box score', async ({
    page,
    request,
  }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');

    const before = await db.countPostGameSends();
    const res = await request.post('/post-game?scenario=empty-positions', {
      form: { timezone: 'Europe/London' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('No open positions right now.');
    expect(body).not.toContain('alert-error');
    expect(body).toContain('>24s<');
    expect(body).toContain('0 lots');

    const after = await db.countPostGameSends();
    expect(after).toBe(before + 1);
  });

  test('TC-06 (AC1): a below-threshold margin level records a foul and a low shot clock', async ({
    page,
    request,
  }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');

    const res = await request.post('/post-game?scenario=low-margin', {
      form: { timezone: 'Europe/London' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('Foul called today');
    expect(body).toContain('>6s<');
    expect(body).toContain('You picked up a foul along the way');
    expect(body).toContain('down 200');
  });

  test('TC-07 (AC1): a failed Post-Game job logs the failure and sends no recap', async ({ page, request }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');

    const beforeTotal = await db.countPostGameSends();
    const res = await request.post('/post-game?scenario=job-error', {
      form: { timezone: 'Europe/London' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('generate the Post-Game recap');
    expect(body).not.toContain('account-details');

    const afterTotal = await db.countPostGameSends();
    expect(afterTotal).toBe(beforeTotal + 1);
  });

  test('TC-08: server rejects a missing timezone even without client-side validation', async ({ page, request }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');

    const before = await db.countPostGameSends();
    const res = await request.post('/post-game', {
      form: { timezone: 'Not/ARealZone' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('Choose a valid timezone');

    const after = await db.countPostGameSends();
    expect(after).toBe(before);
  });

  // TC-09 (SHOT-30 AC3): no trades closed today, the mapping engine still
  // returns a valid box score (zero count, zero realized profit), not an
  // exception, and the view shows the empty state rather than an error.
  // Uses the demo-mode-only ?scenario=no-trades-today hook, same reasoning
  // as the other scenario hooks, the real account's trade history for
  // "today" isn't something this app can force empty on demand.
  test('TC-09 (SHOT-30 AC3): no trades closed today still returns a valid, zero-value box score', async ({
    page,
    request,
  }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');

    const res = await request.post('/post-game?scenario=no-trades-today', {
      form: { timezone: 'Europe/London' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('No trades closed today.');
    expect(body).not.toContain('alert-error');
    expect(body).toContain('>24s<');

    const stored = await db.findPostGameSendsBySession(await sessionIdFromPage(page));
    const latest = stored[stored.length - 1];
    expect(latest.tradesCount).toBe(0);
    expect(latest.tradesRealizedProfit).toBe(0);
  });
});

// The connect.sid cookie is express-session's signed, URL-encoded form
// (s:<sessionId>.<signature>); this strips it back to the raw sessionId
// PostGameSend.sessionId is actually stored as. Mirrors the identical
// decoding already used in connect.spec.js's TC-04.
async function sessionIdFromPage(page) {
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === 'connect.sid');
  const decoded = decodeURIComponent(sessionCookie.value);
  return decoded.slice(2, decoded.lastIndexOf('.'));
}
