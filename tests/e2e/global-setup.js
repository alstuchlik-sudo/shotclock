const { resetConnectionAttempts } = require('./helpers/db');

// Mirrors the manual reset performed before the original test run: clears
// the connection-attempt log so completion-rate math in the suite is
// deterministic on every run, not just the first.
module.exports = async function globalSetup() {
  await resetConnectionAttempts();
};
