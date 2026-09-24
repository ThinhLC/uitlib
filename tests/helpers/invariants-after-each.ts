import { afterEach } from 'vitest';
import { expectNoViolations } from './concurrency';
import { truncateAll } from './fixtures';

let raw = false;

/**
 * Mark the running test as building rows directly as the owner (bypassing procedures) to probe
 * a constraint. Such rows may break invariants on purpose, so the test is not checked and the
 * database is emptied after it.
 */
export function rawFixture(): void {
  raw = true;
}

// SC-005: the invariant suite must stay empty after every acceptance and concurrency test.
afterEach(async () => {
  if (raw) {
    raw = false;
    await truncateAll();
    return;
  }
  await expectNoViolations();
});
