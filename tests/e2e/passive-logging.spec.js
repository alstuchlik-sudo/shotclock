// SHOT-35: System logs opens, unsubscribes, generation cost, and
// trade/risk activity for both sends.
//
// "One logging pipeline instead of separate live-monitoring systems" per
// the ticket's own notes: a single EventLog collection (models/EventLog.js)
// shared by both Pre-Match and Post-Game, instead of scattering these as
// ad-hoc fields across the two already-divergent send models. Generating a
// report on demand IS "opening" it in this app (the same reasoning
// SHOT-27 already applied to what "send" means here, see
// pre-match.spec.js), so the open event fires at generation time, not
// through a separate push/email open-tracking pixel that doesn't exist.
//
// AC3's "generation cost" is genuinely 0 for every event logged here: the
// narrator (services/narrator.js) is a deterministic template, not a paid
// AI call (see the SHOT-26 design note), so 0 is a real measurement, not a
// placeholder standing in for a cost that doesn't exist yet in this build.
//
// Deliberately did not add a new "mute Pre-Match" button to make AC2
// symmetrical across both send types, that would be building a feature
// this ticket didn't ask for ("the system logs..."), not logging one.
// Pre-Match has no unsubscribe/mute action yet (only Post-Game does, from
// SHOT-33), so there is nothing for Pre-Match to log there until a future
// story adds it.
const { test, expect } = require('@playwright/test');
const db = require('./helpers/db');

test.describe.serial('SHOT-35: Passive logging', () => {
  // TC-01 (AC1 + AC3): generating a Pre-Match report logs an open event and
  // a generation_cost event, both tagged sendType 'pre-match' and pointing
  // at the send that was just created.
  test('TC-01 (AC1/AC3): generating a Pre-Match report logs an open and a generation_cost event', async ({
    page,
  }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    await page.getByRole('link', { name: 'Get my Pre-Match report' }).click();
    await page.selectOption('select[name="timezone"]', 'Europe/London');
    await page.getByRole('button', { name: 'Get my Pre-Match report' }).click();

    const sendId = await getPreMatchSendIdFromPage(page);
    const logs = await db.findEventLogsBySend(sendId);

    const open = logs.find((l) => l.eventType === 'open');
    expect(open).toBeTruthy();
    expect(open.sendType).toBe('pre-match');
    expect(open.sessionId).toBe(await sessionIdFromPage(page));
    expect(open.createdAt).toBeTruthy();

    const cost = logs.find((l) => l.eventType === 'generation_cost');
    expect(cost).toBeTruthy();
    expect(cost.sendType).toBe('pre-match');
    expect(cost.generationCost).toBe(0);
  });

  // TC-02 (AC1 + AC3 + AC4): generating a Post-Game recap logs an open, a
  // generation_cost, AND a trade_risk_activity event (Post-Game only,
  // Pre-Match never reconstructs trade history). The trade_risk_activity
  // values are cross-checked against the exact demo mock numbers already
  // established in post-game.spec.js's TC-03 (1 trade, -30 realized,
  // foul-free, 24s shot clock, 0.1 lots exposure).
  test('TC-02 (AC1/AC3/AC4): generating a Post-Game recap logs open, generation_cost, and trade_risk_activity events', async ({
    page,
  }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    await page.getByRole('link', { name: 'Get my Post-Game recap' }).click();
    await page.selectOption('select[name="timezone"]', 'Europe/London');
    await page.getByRole('button', { name: 'Get my Post-Game recap' }).click();

    const sendId = await getPostGameSendIdFromPage(page);
    const logs = await db.findEventLogsBySend(sendId);

    const open = logs.find((l) => l.eventType === 'open');
    expect(open).toBeTruthy();
    expect(open.sendType).toBe('post-game');

    const cost = logs.find((l) => l.eventType === 'generation_cost');
    expect(cost).toBeTruthy();
    expect(cost.sendType).toBe('post-game');
    expect(cost.generationCost).toBe(0);

    const activity = logs.find((l) => l.eventType === 'trade_risk_activity');
    expect(activity).toBeTruthy();
    expect(activity.sendType).toBe('post-game');
    expect(activity.tradesCount).toBe(1);
    expect(activity.tradesRealizedProfit).toBe(-30);
    expect(activity.foul).toBe(false);
    expect(activity.shotClockSeconds).toBe(24);
    expect(activity.exposure).toBe(0.1);
  });

  // TC-03 (AC2): muting a Post-Game recap logs an unsubscribe event tagged
  // to that send type, including the day's foul status (already sitting on
  // the same record, useful for the risk-taking-behavior review this
  // pipeline exists for).
  test('TC-03 (AC2): muting a Post-Game recap logs an unsubscribe event tagged to that send type', async ({
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
    const body = await res.text();
    const sendId = body.match(/\/post-game\/([a-f0-9]{24})\/mute/)[1];

    await request.post(`/post-game/${sendId}/mute`, {
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });

    const logs = await db.findEventLogsBySend(sendId);
    const unsubscribe = logs.find((l) => l.eventType === 'unsubscribe');
    expect(unsubscribe).toBeTruthy();
    expect(unsubscribe.sendType).toBe('post-game');
    expect(unsubscribe.foul).toBe(true);
  });

  // TC-04 (defect probe): a failed Post-Game job never actually generated
  // anything a user could "open", the AC is framed around a user opening a
  // real send, so no open/generation_cost/trade_risk_activity events should
  // exist for a failed attempt, only a successful generation counts.
  test('TC-04 (defect probe): a failed Post-Game job logs no open/generation_cost/trade_risk_activity events', async ({
    page,
    request,
  }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const sessionId = await sessionIdFromPage(page);
    const before = (await db.findEventLogsBySession(sessionId)).length;

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');
    await request.post('/post-game?scenario=job-error', {
      form: { timezone: 'Europe/London' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });

    const after = await db.findEventLogsBySession(sessionId);
    expect(after.length).toBe(before);
  });
});

async function sessionIdFromPage(page) {
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === 'connect.sid');
  const decoded = decodeURIComponent(sessionCookie.value);
  return decoded.slice(2, decoded.lastIndexOf('.'));
}

async function getPreMatchSendIdFromPage(page) {
  const action = await page.locator('.feedback-form').getAttribute('action');
  return action.match(/\/pre-match\/([a-f0-9]{24})\/feedback/)[1];
}

async function getPostGameSendIdFromPage(page) {
  const action = await page.locator('.feedback-form').getAttribute('action');
  return action.match(/\/post-game\/([a-f0-9]{24})\/feedback/)[1];
}
