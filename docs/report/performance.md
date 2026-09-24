# Performance of operation procedures

Measured by `tests/concurrency/perf.test.ts` on 2026-09-24 against the local
Docker MySQL 8.4 test schema, including the client round trip (callProcedure).
Goal (plan.md Technical Context): p50 < 200 ms and p95 < 1 s.

| Procedure | Calls | p50 (ms) | p95 (ms) | max (ms) |
| --- | --- | --- | --- | --- |
| sp_checkout | 60 | 3.3 | 4.5 | 7.2 |
| sp_return_item | 60 | 2.1 | 2.8 | 3.6 |
