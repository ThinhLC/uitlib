import { resetTestSchema } from '../../scripts/db/reset-test';

/** Re-create ${DB_NAME}_test from migrations once before the test run. */
export default async function setup(): Promise<void> {
  await resetTestSchema(() => {});
}
