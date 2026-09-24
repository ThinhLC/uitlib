-- [Ext] Scheduled hold expiry (tasks T097; spec FR-014c: at least every 15 minutes).
-- Needs event_scheduler=ON (docker/mysql/conf.d/mysql.cnf). The test schema disables it after
-- migrating (scripts/db/reset-test.ts), because tests pass explicit times.

CREATE EVENT `ev_expire_holds`
  ON SCHEDULE EVERY 15 MINUTE
  ON COMPLETION PRESERVE
  ENABLE
  COMMENT 'Expire ready reservations past their hold expiry and promote the queue'
  DO CALL sp__expire_holds_batch(UTC_TIMESTAMP(3), @expired_count);
