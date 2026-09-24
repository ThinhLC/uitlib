# Performance of operation procedures

Measured by `tests/concurrency/perf.test.ts` on 2026-09-24 against the local
Docker MySQL 8.4 test schema, including the client round trip (callProcedure).
Goal (plan.md Technical Context): p50 < 200 ms and p95 < 1 s.

| Procedure | Calls | p50 (ms) | p95 (ms) | max (ms) |
| --- | --- | --- | --- | --- |
| sp_checkout | 60 | 2.5 | 3.7 | 7.8 |
| sp_return_item | 60 | 1.6 | 1.9 | 2.7 |
