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
//
// SHOT-31: System computes the user's personal-best discipline streak.
// This app has no persistent Account model or scheduler, same constraint as
// SHOT-29 above, so "a day" for streak purposes means "one Post-Game send
// for this session" (see services/streakTracker.js), not a deduplicated
// calendar day. TC-10 walks a single session through a sequence of sends to
// demonstrate all three ACs against that interpretation.
//
// SHOT-33: User gives one-tap feedback on the Post-Game recap. Same shared
// rating mechanism as Pre-Match's feedback (SHOT-27), reused for the
// evening send; "tagged as a foul/foul-free day" needs no extra logic since
// rating/muted live on the same PostGameSend record as its own `foul`
// field already does. AC3's "mute the Post-Game send" is scoped the same
// way as the rest of this pipeline: there's no real push/email send to
// unsubscribe from in this on-demand model, so it's a second one-tap action
// on the already-generated recap (see routes/postgame.js).
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

    // SHOT-32 AC1: this session's first-ever send is also its personal
    // best by default (SHOT-31 AC3), the narration states that.
    await expect(narration).toContainText('Tonight sets a new personal best, 1 day foul-free');

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

    // SHOT-32 AC1: a fouled first-ever day resets the streak to 0 (SHOT-31),
    // and the narration states the personal best (still 0, nothing to
    // compare against yet) holds rather than claiming a false streak.
    // Substring stops before the apostrophe in "tonight's", raw HTML has
    // it HTML-entity-escaped (&#39;) by EJS, same trap as pre-match.spec.js's
    // TC-15.
    expect(body).toContain('Personal best holds at 0 after tonight');
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

  // TC-10 (SHOT-31 AC1/AC2/AC3 + SHOT-32 AC1): the personal-best streak
  // tracks correctly across a sequence of Post-Game sends within one
  // session, and the AI narration states today's result against that
  // record correctly at each turning point. Walks: this session's
  // first-ever send (AC3, becomes the personal best by default), a run of
  // foul-free sends pushing the record past its previous ceiling (AC1),
  // then a foul breaking the streak followed by a shorter run that doesn't
  // touch the record (AC2), checking both the structured stat line and the
  // narrated recap reference the gap to the record.
  test('TC-10 (AC1/AC2/AC3): personal-best streak tracks correctly across a sequence of days', async ({
    page,
    request,
  }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');
    const cookieHeader = { Cookie: `connect.sid=${sessionCookie.value}` };
    const sessionId = await sessionIdFromPage(page);

    async function generate(scenario) {
      const url = scenario ? `/post-game?scenario=${scenario}` : '/post-game';
      const res = await request.post(url, { form: { timezone: 'Europe/London' }, headers: cookieHeader });
      return res.text();
    }

    async function latestStreak() {
      const sends = await db.findPostGameSendsBySession(sessionId);
      const latest = sends[sends.length - 1];
      return { streak: latest.streak, personalBest: latest.personalBest };
    }

    // AC3: this session's first-ever day, foul-free, becomes the personal
    // best by default.
    await generate();
    expect(await latestStreak()).toEqual({ streak: 1, personalBest: 1 });

    // Four more foul-free days build the streak and the record up to 5.
    for (let i = 0; i < 4; i++) await generate();
    expect(await latestStreak()).toEqual({ streak: 5, personalBest: 5 });

    // AC1: one more foul-free day pushes both the streak and the record to
    // 6. SHOT-32: the narration states this is a new personal best.
    const day6Body = await generate();
    expect(await latestStreak()).toEqual({ streak: 6, personalBest: 6 });
    expect(day6Body).toContain('Tonight sets a new personal best, 6 days foul-free');

    // A fouled day resets the streak, the record stays at 6. SHOT-32: the
    // narration states the record holds rather than claiming a streak.
    const day7Body = await generate('low-margin');
    expect(await latestStreak()).toEqual({ streak: 0, personalBest: 6 });
    // Substring stops before the apostrophe, same reason as TC-06.
    expect(day7Body).toContain('Personal best holds at 6 after tonight');

    // AC2: two more foul-free days, then a third whose rendered recap is
    // checked directly, the streak (3) stays under the untouched record
    // (6), and both the stat line and the narration reference the 3-day gap.
    await generate();
    await generate();
    const finalBody = await generate();
    expect(await latestStreak()).toEqual({ streak: 3, personalBest: 6 });
    expect(finalBody).toContain('3-day foul-free streak');
    expect(finalBody).toContain('Personal best is 6');
    expect(finalBody).toContain('3 days off the record');
    // Drops the leading "That's " (apostrophe), same reason as above.
    expect(finalBody).toContain('3 days foul-free, 3 days short of your personal best of 6');
  });

  // TC-11 (defect probe): a PostGameSend created before SHOT-31 shipped has
  // no streak/personalBest fields at all. computeStreak previously read
  // `previous.streak` unconditionally once `previous` was truthy, so a
  // legacy record like this produced `undefined + 1` (NaN), which then
  // failed Mongoose's Number cast on save, this exact bug shipped to
  // production. Simulates that record directly (the app itself can never
  // produce one going forward) and confirms generation now succeeds,
  // treating the missing fields as a fresh start (streak 1, personal best 1).
  test('TC-11 (defect probe): a legacy send missing streak fields does not break generation', async ({
    page,
    request,
  }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const sessionId = await sessionIdFromPage(page);

    await db.insertRawPostGameSend({
      sessionId,
      timezone: 'Europe/London',
      localTimeAtSend: 'Jul 1, 2026, 8:00 PM',
      status: 'success',
      foul: false,
      createdAt: new Date(Date.now() - 60000),
    });

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');
    const res = await request.post('/post-game', {
      form: { timezone: 'Europe/London' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("Couldn't generate the Post-Game recap");
    expect(body).toContain('1-day foul-free streak');

    const sends = await db.findPostGameSendsBySession(sessionId);
    const latest = sends[sends.length - 1];
    expect(latest.streak).toBe(1);
    expect(latest.personalBest).toBe(1);
  });

  // TC-12 (SHOT-32 AC2): a direct A/B check that the same session's
  // Pre-Match and Post-Game narrations, generated back to back against the
  // exact same underlying account snapshot, use their own distinct tone
  // templates and don't repeat each other's wording, not just that the
  // template ids differ (already covered elsewhere), the actual sentences
  // are compared.
  test("TC-12 (AC2): Post-Game narration uses its own tone and doesn't repeat the Pre-Match wording", async ({
    page,
    request,
  }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');
    const cookieHeader = { Cookie: `connect.sid=${sessionCookie.value}` };

    const preMatchRes = await request.post('/pre-match', {
      form: { timezone: 'Europe/London' },
      headers: cookieHeader,
    });
    const preMatchBody = await preMatchRes.text();
    const preMatchMatch = preMatchBody.match(/class="narration" data-template-id="([^"]*)">([^<]*)</);
    expect(preMatchMatch[1]).toBe('pre-match-v1');
    const preMatchText = preMatchMatch[2];

    const postGameRes = await request.post('/post-game', {
      form: { timezone: 'Europe/London' },
      headers: cookieHeader,
    });
    const postGameBody = await postGameRes.text();
    const postGameMatch = postGameBody.match(/class="narration" data-template-id="([^"]*)">([^<]*)</);
    expect(postGameMatch[1]).toBe('post-game-v1');
    const postGameText = postGameMatch[2];

    // Distinct templates, not just distinct ids: the full narration text
    // is not identical, and neither one's opening sentence appears in the
    // other's text.
    expect(postGameText).not.toBe(preMatchText);
    expect(preMatchText.startsWith('Tip-off.')).toBe(true);
    expect(postGameText.startsWith('Final buzzer.')).toBe(true);
    expect(postGameText).not.toContain('Tip-off. ');
    expect(preMatchText).not.toContain('Final buzzer. ');
  });

  // TC-13 (SHOT-33 AC1): a net-negative but foul-free day still records the
  // rating, tagged as foul-free on the same record (the default demo mock:
  // netProfit -15, marginLevel well above threshold so no foul).
  test('TC-13 (AC1): rating a net-negative foul-free day is recorded and tagged foul-free', async ({ page }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);

    await page.getByRole('link', { name: 'Get my Post-Game recap' }).click();
    await page.selectOption('select[name="timezone"]', 'Europe/London');
    await page.getByRole('button', { name: 'Get my Post-Game recap' }).click();

    const sendId = await getSendIdFromPage(page);

    await page.fill('.feedback-text-input', 'Tough day but stayed disciplined.');
    await page.getByRole('button', { name: 'Rate 4 out of 5' }).click();

    await expect(page.locator('h1')).toContainText('Thanks for your feedback');
    await expect(page.locator('.subtitle')).toContainText('4 out of 5');

    const stored = await db.findPostGameSendById(sendId);
    expect(stored.rating).toBe(4);
    expect(stored.feedbackText).toBe('Tough day but stayed disciplined.');
    expect(stored.foul).toBe(false);
  });

  // TC-14 (SHOT-33 AC2): a foul day's rating is recorded and tagged as a
  // foul day, same co-located-field reasoning as TC-13.
  test('TC-14 (AC2): rating a foul day is recorded and tagged as a foul day', async ({ page, request }) => {
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
    const sendIdMatch = body.match(/\/post-game\/([a-f0-9]{24})\/feedback/);
    const sendId = sendIdMatch[1];

    const feedbackRes = await request.post(`/post-game/${sendId}/feedback`, {
      form: { rating: '2' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(feedbackRes.status()).toBe(200);
    const feedbackBody = await feedbackRes.text();
    expect(feedbackBody).toContain('Thanks for your feedback');
    expect(feedbackBody).toContain('2 out of 5');

    const stored = await db.findPostGameSendById(sendId);
    expect(stored.rating).toBe(2);
    expect(stored.foul).toBe(true);
  });

  // TC-15 (SHOT-33 AC3): muting instead of rating on a foul day is recorded
  // (rating stays unset, muted becomes true) and tagged as a foul day, same
  // co-located-field reasoning, this time via the mute route.
  test('TC-15 (AC3): muting a foul day is recorded and tagged as a foul day', async ({ page, request }) => {
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
    const sendIdMatch = body.match(/\/post-game\/([a-f0-9]{24})\/mute/);
    const sendId = sendIdMatch[1];

    const muteRes = await request.post(`/post-game/${sendId}/mute`, {
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(muteRes.status()).toBe(200);
    const muteBody = await muteRes.text();
    expect(muteBody).toContain('Post-Game muted');

    const stored = await db.findPostGameSendById(sendId);
    expect(stored.muted).toBe(true);
    expect(stored.rating).toBeUndefined();
    expect(stored.foul).toBe(true);
  });

  // TC-16 (defect probe): mirrors pre-match.spec.js's TC-22, ids are Mongo
  // ObjectIds, guessable/enumerable on a public demo app, so both the
  // feedback and mute routes must scope their update by sessionId too, not
  // id alone.
  test("TC-16 (defect probe): feedback and mute cannot target another session's send", async ({
    page,
    request,
  }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);
    await page.getByRole('link', { name: 'Get my Post-Game recap' }).click();
    await page.selectOption('select[name="timezone"]', 'Europe/London');
    await page.getByRole('button', { name: 'Get my Post-Game recap' }).click();
    const sendId = await getSendIdFromPage(page);

    const connectRes = await request.post('/connect', { maxRedirects: 0 });
    expect(connectRes.status()).toBe(302);

    const feedbackRes = await request.post(`/post-game/${sendId}/feedback`, {
      form: { rating: '3' },
    });
    expect(feedbackRes.status()).toBe(404);

    const muteRes = await request.post(`/post-game/${sendId}/mute`);
    expect(muteRes.status()).toBe(404);

    const stored = await db.findPostGameSendById(sendId);
    expect(stored.rating).toBeUndefined();
    expect(stored.muted).toBe(false);
  });

  // TC-17: the rating buttons only ever submit fixed values 1-5, but the
  // server must independently reject anything outside that range from a
  // bare POST that bypasses them, same reasoning as pre-match.spec.js's
  // TC-23.
  test('TC-17: server rejects a rating outside 1-5 even without client-side validation', async ({
    page,
    request,
  }) => {
    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();
    await expect(page).toHaveURL(/\/connect\/success$/);
    await page.getByRole('link', { name: 'Get my Post-Game recap' }).click();
    await page.selectOption('select[name="timezone"]', 'Europe/London');
    await page.getByRole('button', { name: 'Get my Post-Game recap' }).click();
    const sendId = await getSendIdFromPage(page);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');

    const res = await request.post(`/post-game/${sendId}/feedback`, {
      form: { rating: '0' },
      headers: { Cookie: `connect.sid=${sessionCookie.value}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('Choose a rating between 1 and 5');

    const stored = await db.findPostGameSendById(sendId);
    expect(stored.rating).toBeUndefined();
  });
});

// The feedback form's own action attribute is the only place the just-
// created send's id is exposed to the page, mirrors pre-match.spec.js's
// identical helper.
async function getSendIdFromPage(page) {
  const action = await page.locator('.feedback-form').getAttribute('action');
  const match = action.match(/\/post-game\/([a-f0-9]{24})\/feedback/);
  return match[1];
}

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
