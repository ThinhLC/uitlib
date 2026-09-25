# Performance of operation procedures

Measured by `tests/concurrency/perf.test.ts` on 2026-09-25 against the local
Docker MySQL 8.4 test schema, including the client round trip (callProcedure).
Goal (plan.md Technical Context): p50 < 200 ms and p95 < 1 s.

| Procedure | Calls | p50 (ms) | p95 (ms) | max (ms) |
| --- | --- | --- | --- | --- |
| sp_checkout | 60 | 3.2 | 4.2 | 8.0 |
| sp_return_item | 60 | 2.1 | 4.0 | 5.0 |
