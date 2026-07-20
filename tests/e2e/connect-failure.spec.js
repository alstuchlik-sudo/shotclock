// SHOT-22 (AC2): invalid/unreachable connection path.
//
// This spec requires the app to be started with an UNREACHABLE
// CTRADER_MCP_URL (the real cTrader Desktop MCP server has no way to be
// told to reject a connection on demand, and there is no test-only bypass
// in the app). Run it as a separate pass from connect.spec.js:
//
//   CTRADER_MCP_URL=http://127.0.0.1:9/mcp/ npm run dev   # in one terminal
//   npx playwright test tests/e2e/connect-failure.spec.js # in another
//
// It is intentionally excluded from the default `npx playwright test` run
// for that reason, see package.json's test:e2e script.
const { test, expect } = require('@playwright/test');
const db = require('./helpers/db');

test.describe('SHOT-22: Connect account failure path', () => {
  test('TC-02: unreachable cTrader Desktop shows a real error and logs a drop-off', async ({ page }) => {
    const beforeDropOff = await db.countByOutcome('drop_off');

    await page.goto('/connect');
    await page.getByRole('button', { name: 'Connect to cTrader' }).click();

    await expect(page).toHaveURL(/\/connect$/);
    await expect(page.locator('.alert-error')).toContainText("Couldn't reach cTrader Desktop");

    const afterDropOff = await db.countByOutcome('drop_off');
    expect(afterDropOff).toBe(beforeDropOff + 1);
  });
});
