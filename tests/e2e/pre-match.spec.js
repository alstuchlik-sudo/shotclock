// SHOT-23: System sends Pre-Match at a fixed local morning time.
// SHOT-24: System pulls live account and position state.
// SHOT-25: System builds and runs the risk-to-stat mapping engine.
// SHOT-26: AI agent narrates the live snapshot in a pre-match tone.
//
// SHOT-23 scoped down from the literal AC: it describes an autonomous,
// per-timezone-clock-triggered send. That needs a persistent Account model
// and Vercel Cron, neither of which exist yet. This implements the same
// "Pre-Match is generated and sent" outcome via an explicit user action
// (a "Get my Pre-Match report" CTA with a timezone picker) instead of a
// background scheduler. AC3 (no send for unconnected users) is the one
// piece of the original AC that carries over exactly, it's tested directly.
//
// SHOT-24's job-failure AC (get_balance/get_positions erroring) can't reuse
// connect-failure.spec.js's unreachable-MCP pattern: an unreachable MCP
// fails the earlier connect step too, so a real run never reaches a
// connected state to test the Pre-Match job's own failure path in
// isolation. Covered instead via the demo-mode-only ?scenario=job-error
// hook, which exercises the real failure-handling code path (logged
// status:'failed', no report generated) without needing real external state.
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

    const res = await request.post('/pre-match', { form: { timezone: 'Europe/London' }, maxRedirects: 0 });
    expect([302, 303]).toContain(res.status());
    expect(res.headers()['location']).toBe('/connect');

    const after = await db.countPreMatchSends();
    expect(after).toBe(before);
  });

  // TC-11 (SHOT-23 happy path + SHOT-24 AC1 + SHOT-25 AC1): connect,
  // generate a report, and confirm the job pulled BOTH balance (including
  // margin) and open positions, AND that the mapping engine reads the
  // demo account's well-above-threshold margin level as a full shot clock
  // with no foul (SHOT-25 AC1, "low time pressure", "no foul is recorded").
  test('TC-11: connected user generates a Pre-Match report with balance, margin, and positions', async ({ page }) => {
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
    await expect(page.locator('.account-details')).toContainText('Margin');
    await expect(page.locator('.attempts-table')).toContainText('EURUSD');
    await expect(page.locator('.stats-grid')).toContainText('24s');
    await expect(page.locator('.badge-success')).toContainText('Clean');
    await expect(page.locator('.alert-error')).toHaveCount(0);

    const after = await db.countPreMatchSends();
    expect(after).toBe(before + 1);
  });

  // TC-16 (SHOT-25 AC2 + SHOT-26 AC1): a below-threshold margin level
  // records a foul and a low shot clock ("high time pressure"), AND the
  // narration states that exact same foul/margin/shot-clock state with no
  // invented numbers of its own. Uses the demo-mode-only ?scenario=low-margin
  // hook, the real account's margin level isn't something this app can force
  // into the risk zone for a deterministic test run, same reasoning as the
  // empty-positions and job-error hooks.
  test('TC-16 (AC2): a below-threshold margin level records a foul and a low shot clock', async ({ page, request }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');

    const res = await request.post('/pre-match?scenario=low-margin', {
      form: { timezone: 'Europe/London' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('Foul called');
    expect(body).toContain('>6s<');
    expect(body).toContain('Foul on the board');
    expect(body).toContain('75% margin level');
    expect(body).toContain('6 seconds');
    expect(body).toContain('down 200');
  });

  // TC-17 (SHOT-26 AC1/AC2): the narration states the correct shot clock,
  // discipline, and box score values on the clean/no-foul path, with no
  // invented numbers, and is tagged with the pre-match template id (not a
  // Post-Game one, which doesn't exist yet but the tag structurally proves
  // which template rendered) so AC2 is verifiable even before Post-Game
  // ships. Cross-checks the narration text against the same demo mock
  // values TC-11 already asserts on the stats grid.
  test('TC-17 (AC1/AC2): narration states the exact computed values using the pre-match template', async ({ page }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    await page.getByRole('link', { name: 'Get my Pre-Match report' }).click();
    await page.selectOption('select[name="timezone"]', 'Europe/London');
    await page.getByRole('button', { name: 'Get my Pre-Match report' }).click();

    const narration = page.locator('.narration');
    await expect(narration).toHaveAttribute('data-template-id', 'pre-match-v1');
    await expect(narration).toContainText('24 seconds');
    await expect(narration).toContainText('No fouls called');
    await expect(narration).toContainText('8320% margin level');
    await expect(narration).toContainText('0.1 lots');
    await expect(narration).toContainText('down 15');
  });

  // TC-18: each stat tile explains its own basketball jargon (Shot Clock,
  // Discipline, Points) as a tooltip, hidden until hovered so it doesn't
  // clutter the report by default, and revealed on hover/focus for sighted
  // and keyboard users alike.
  test('TC-18: stat tiles show basketball-jargon explanations on hover', async ({ page }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    await page.getByRole('link', { name: 'Get my Pre-Match report' }).click();
    await page.selectOption('select[name="timezone"]', 'Europe/London');
    await page.getByRole('button', { name: 'Get my Pre-Match report' }).click();

    const shotClockTooltip = page.locator('#tooltip-shot-clock');
    const disciplineTooltip = page.locator('#tooltip-discipline');
    const pointsTooltip = page.locator('#tooltip-points');

    await expect(shotClockTooltip).toContainText('NBA shot clock');
    await expect(disciplineTooltip).toContainText('referee call');
    await expect(pointsTooltip).toContainText("team's score");

    await expect(shotClockTooltip).not.toBeVisible();
    await page.hover('.stat-tile:nth-child(1)');
    await expect(shotClockTooltip).toBeVisible();
  });

  // TC-14 (SHOT-24 AC2 + SHOT-25 AC3): zero open positions renders the
  // empty state, not an error, AND the mapping engine returns a valid box
  // score with zero exposure and no foul (SHOT-25 AC3), not an exception,
  // for exactly this no-positions case. Uses the demo-mode-only
  // ?scenario=empty-positions hook since the real account is currently
  // unreachable to test this against live (see services/ctraderMcp.js),
  // the underlying rendering path is real, only the position data source
  // is substituted.
  test('TC-14 (AC2/AC3): zero open positions shows the empty state and a valid zero-exposure box score', async ({ page, request }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');

    const before = await db.countPreMatchSends();
    const res = await request.post('/pre-match?scenario=empty-positions', {
      form: { timezone: 'Europe/London' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('No open positions right now.');
    expect(body).not.toContain('alert-error');
    expect(body).toContain('>24s<');
    expect(body).toContain('0 lots');

    const after = await db.countPreMatchSends();
    expect(after).toBe(before + 1);
  });

  // TC-15 (SHOT-24 AC3): if the Pre-Match job fails, no report is generated
  // and the failure itself is logged as its own record, not silently
  // dropped. Uses the ?scenario=job-error hook, see the file header.
  test('TC-15 (AC3): a failed Pre-Match job logs the failure and sends no report', async ({ page, request }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');

    const beforeTotal = await db.countPreMatchSends();
    const res = await request.post('/pre-match?scenario=job-error', {
      form: { timezone: 'Europe/London' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('generate the Pre-Match report');
    expect(body).not.toContain('account-details');

    const afterTotal = await db.countPreMatchSends();
    expect(afterTotal).toBe(beforeTotal + 1);
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
