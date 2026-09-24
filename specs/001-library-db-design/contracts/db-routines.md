# Contract: Database Routines (functions, procedures, cursors)

This is the database's public interface. The seed script and tests call it now; the API will
call it later (spec FR-026). Everything here is created by custom migrations run as the owner
account (`root`), with `SQL SECURITY DEFINER`. `scripts/db/grants.ts` grants the
routines marked *public* to the app account (`$DB_USER`); both account names come from the
environment (spec FR-030).

## Calling rules (all operation procedures)

- Call with autocommit on and **no open transaction**: each procedure runs `START TRANSACTION`
  itself, which would silently commit an open one.
- `p_actor_user_id`: the account performing the action. The procedure checks
  `fn_has_permission(p_actor_user_id, <permission>)`, which is false for missing or `inactive`
  accounts. A failed check raises `FORBIDDEN` before any lock or write. **[API]** Later the API
  passes the id taken from a verified Supabase token.
- `p_now DATETIME(3)`: the current UTC instant. Procedures use it for every business time
  (borrow, due, return, paid, validity checks); `NOW()` is never used for decisions.
- On any error the procedure rolls back its whole transaction and re-raises it: business
  rejections as `SQLSTATE '45000'` with `MESSAGE_TEXT = '<KEY>: <detail>'`; deadlock (1213),
  lock wait timeout (1205), duplicate key (1062) and others as the original error. `callProcedure`
  reports a 1062 to the app as `DbRuleError` key `DUPLICATE` with the unique index name as detail
  (e.g. `library_cards_active_reader_uq`, `book_copies_barcode_uq`). Callers retry
  only 1213/1205, up to 3 times with a 50–200 ms random back-off.
- Locks follow the spec's global order: reader type → reader → card → book → copy → policy
  version → loan → loan item → reservation → fine. Within one kind, rows are locked in ascending
  id; reservations in `(requested_at, id)` order. [Ext] Every writer of a book's copies or
  reservations locks the `books` row first, so reservation work on one book is serialized.
  Policy procedures also take `material_types` `FOR SHARE` right after the reader type; no other
  flow locks material types, so this adds no cycle.
- **Decisions use locking reads only.** Every value that decides a write (debt, balances, open
  items, overdue items, card validity) comes from `SELECT … FOR UPDATE` / `FOR SHARE` taken
  after the reader lock. The balance functions `fn_fine_net`, `fn_fine_remaining` and
  `fn_reader_outstanding` use plain reads; they are for views and reports and MUST NOT decide a
  write. `START TRANSACTION WITH CONSISTENT SNAPSHOT` is not used (research R5). The one
  deliberate exception is the hard-eligibility read in `sp__promote_queue` (see Internal
  helpers).

## Error keys

| Key | Raised when |
| --- | --- |
| `FORBIDDEN` | Actor missing, inactive, or lacks the permission; [Ext] for reserve/cancel: not staff and not the reader's own active account (cancel: also a missing reservation id for a non-staff actor, so ids cannot be probed) |
| `NOT_FOUND` | A referenced id does not exist |
| `VALIDATION` | Bad input shape or range (empty list, duplicate id, amount ≤ 0, …); [Ext] reserve when the book has an `available` copy or the reader has it on loan; staff cancel without a reason |
| `COPY_NOT_AVAILABLE` | Copy not `available`, or `on_hold` for another reader |
| `READER_NOT_ACTIVE` | Reader `suspended` / `inactive` (checkout; [Ext] reserve) |
| `CARD_INVALID` | No card that is `active` and unexpired at `p_now` (checkout; [Ext] reserve) |
| `DEBT_BLOCKED` | Outstanding debt > the version's threshold |
| `OVERDUE_BLOCKED` | Reader has an overdue item (D7) |
| `LIMIT_REACHED` | Open items + requested items > max active items |
| `NO_POLICY` | No version covers (reader type, material type, `p_now`) |
| `RENEWAL_REJECTED` | Not on loan, overdue, at limit, or waiting reservation (detail names which) |
| `INVALID_TRANSITION` | Status change not allowed (procedure check or trigger, incl. `trg_reservations_bu`) |
| `POLICY_OVERLAP` | Version would overlap another for the same pair |
| `POLICY_CLOSE_REJECTED` | Close is retroactive, extends, or not after every referencing borrow |
| `POLICY_IMMUTABLE` | Trigger: business value of a version changed |
| `SNAPSHOT_IMMUTABLE` | Trigger: loan item identity/snapshot changed |
| `APPEND_ONLY` | Trigger: update/delete on fines or money rows |
| `COPY_STATE` | Trigger: copy status disagrees with loan items (I-1); [Ext] checkout: an `on_hold` copy with no `ready` reservation (I-2) |
| `FINE_RULE` | Fine amount out of range, missing reason, damaged+lost conflict |
| `ALLOCATION_MISMATCH` | Σ allocations ≠ amount, over a fine's remaining balance, or another reader's fine |
| `PAYMENT_EXCEEDS_DEBT` | Payment > reader's outstanding |
| `DUPLICATE` | A unique key was hit (1062 mapped by `callProcedure`; detail = index name, e.g. `reservations_active_uq` for a second `waiting`/`ready` reservation of the same reader and book) |
| `IDEMPOTENCY_CONFLICT` | Payment request key reused with a different reader, amount or allocations |

## Functions [Core, public]

| Signature | Returns | Characteristic | Definition |
| --- | --- | --- | --- |
| `fn_local_date(p_ts DATETIME(3))` | DATE | DETERMINISTIC | `DATE(p_ts + INTERVAL 7 HOUR)` |
| `fn_due_at(p_borrowed_at DATETIME(3), p_loan_days INT)` | DATETIME(3) | DETERMINISTIC | UTC instant of 23:59:59.999 local on `fn_local_date(p_borrowed_at) + p_loan_days` |
| `fn_days_late(p_due_at DATETIME(3), p_end_at DATETIME(3))` | INT | DETERMINISTIC | `GREATEST(0, DATEDIFF(fn_local_date(p_end_at), fn_local_date(p_due_at)))` |
| `fn_late_fee(p_days INT, p_daily_fee BIGINT, p_cap BIGINT)` | BIGINT | DETERMINISTIC | `p_days * p_daily_fee`, then `LEAST(…, p_cap)` when `p_cap` is not NULL |
| `fn_fine_net(p_fine_id BIGINT)` | BIGINT | READS SQL DATA | assessed + Σ adjustments |
| `fn_fine_remaining(p_fine_id BIGINT)` | BIGINT | READS SQL DATA | net − Σ allocations |
| `fn_reader_outstanding(p_reader_id BIGINT, p_as_of DATETIME(3))` | BIGINT | READS SQL DATA | Σ assessed (≤ as_of) + Σ adjustments (≤ as_of) − Σ payments (≤ as_of) |
| `fn_has_permission(p_user_id BIGINT, p_code VARCHAR(64))` | BOOLEAN | READS SQL DATA | account exists, is `active`, and one of its roles grants `p_code` |

Expected values (from spec US2-10, US4-1, US4-3): `fn_due_at('2026-09-30 16:59:59.900', 14)` =
`'2026-10-14 16:59:59.999'` (local 23:59:59.999 on 2026-10-14);
`fn_days_late(due 2026-10-10 local, returned 2026-10-13 local)` = 3;
`fn_late_fee(10, 2000, 150000)` = 20000.

## Operation procedures [Core, public]

| Procedure | Permission | Parameters (after `p_actor_user_id`, `p_now`) | OUT / result | Locks, then writes | Spec |
| --- | --- | --- | --- | --- | --- |
| `sp_create_policy_version` | `policy.manage` | reader_type_id, material_type_id, max_active_items, loan_days, max_renewals, daily_late_fee_vnd, debt_block_threshold_vnd, valid_from | `p_policy_id` | reader type → versions of pair; reject `POLICY_OVERLAP`; insert | FR-009, R-09a |
| `sp_close_policy_version` | `policy.manage` | policy_id, valid_to | — | reader type → version; reject `POLICY_CLOSE_REJECTED` if `valid_to` < `p_now`, not earlier than current, ≤ `valid_from`, or ≤ max referencing `borrowed_at` | FR-009c, R-09e |
| `sp_issue_card` | `card.manage` | reader_id, card_number, expires_at | `p_card_id` | reader → reader's cards; insert (UQ → 1062, reported as `DUPLICATE` re-raised) | FR-008, R-08a/c |
| `sp_set_card_status` | `card.manage` | card_id, status | — | reader → card; only `active → expired \| lost \| revoked`, else `INVALID_TRANSITION`. All three are terminal: a card never returns to `active`; issue a new card instead | FR-008 |
| `sp_register_copy` | `catalog.write` | book_id, barcode, shelf_code, acquired_at, condition | `p_copy_id` | book; insert as `available` (or `in_repair` if damaged); [Ext] a copy that is not damaged then runs `sp__promote_queue` (queue locked last), so it may end `on_hold` | FR-006, FR-006a |
| `sp_change_copy_status` | `catalog.write` | copy_id, target_status, condition | — | book → copy; lifecycle check (`INVALID_TRANSITION` if the copy is `on_loan`/`on_hold`, or the target is `available` while the (new) condition is `damaged`); [Ext] target `available` (repair done, found) then runs `sp__promote_queue` | FR-006a |
| `sp_checkout` | `loan.checkout` | reader_id, copy_ids JSON `[id,…]` | result set: loan_id, loan_item_id, copy_id, due_at | [Ext] step 0 before the transaction: overdue holds on the requested copies are expired through `sp__expire_hold`, each in its own committed transaction (below); then reader → reader's cards (S) → books ↑ → copies ↑ (each `available` or [Ext] `on_hold`) → policy (S) → [Ext] reservation (step 6b, below; `on_hold` without a ready reservation → `COPY_STATE`); eligibility (FR-009d) with locking reads, debt by `SUM … FOR SHARE`; insert loan, items (snapshot + `fn_due_at`), [Ext] holder's reservations `fulfilled`, then copies `on_loan`; all-or-nothing (except the step-0 expiry, which stays) | FR-009b/d, FR-010–012, R-12b, R-14f |
| `sp_return_item` | `loan.return` | loan_item_id, return_condition, damaged_fine_vnd NULL, reason NULL | result set of assessed fines | reader → book → copy → loan → loan item → [Ext] queue; item `returned`; `sp__assess_fines`; copy `in_repair` if damaged, else `available` and [Ext] `sp__promote_queue`; loan closed if last | FR-015a/b, R-10a, R-14e |
| `sp_declare_lost` | `loan.return` | loan_item_id, lost_fine_vnd NULL, reason NULL | result set of assessed fines | as return; item `lost`, copy `lost`; late (to `p_now`) + lost fines | FR-015a/b |
| `sp_renew` | `loan.renew` | loan_item_id | `p_new_due_at` | reader → book → loan item → book's `waiting` reservations (S); checks (FR-013): `not_on_loan`, `overdue`, `limit`, then `reserved` if any `waiting` reservation exists (a `ready` hold does not block); update due and count; insert renewal | FR-013, R-13a |
| `sp_record_payment` | `fine.collect` | reader_id, amount_vnd, method, reference_no, request_key, allocations JSON `[{fine_id, amount_vnd}]` | `p_payment_id`, `p_replayed` | see below | FR-016, R-16b–e |
| `sp_adjust_fine` | `fine.adjust` | fine_id, amount_vnd (≠ 0), reason | `p_adjustment_id` | reader (of the fine) → fine `FOR UPDATE`; net and allocated read with `FOR SHARE`; `FINE_RULE` if the reason is blank or afterwards net < allocated or net < 0; insert with `adjusted_at = p_now` | FR-017, R-17a |

### `sp_record_payment` steps

1. Permission check (`FORBIDDEN`); `request_key` required (`VALIDATION`).
2. If `request_key` exists: `sp__check_replay` compares reader, amount and allocations with the
   stored payment. Equal → return that payment, `p_replayed = TRUE`, no writes. Different →
   `IDEMPOTENCY_CONFLICT`.
3. Validate the input before any lock: amount > 0, method, allocations expanded with
   `JSON_TABLE`; `VALIDATION` if the list is empty, has a duplicate fine, or an amount ≤ 0.
4. `START TRANSACTION`; lock the reader. Every other writer of this reader's fines (return, lost,
   adjustment, payment) locks the reader first, so the sums below cannot change underneath.
5. `PAYMENT_EXCEEDS_DEBT` if `amount_vnd` > the reader's total remaining, from assessed +
   adjustments − allocations read `FOR SHARE`.
6. Lock the fines in ascending id (`FOR UPDATE OF f`), joined to `loan_items → loans`.
   `ALLOCATION_MISMATCH` if a fine is missing or belongs to another reader, if an allocation >
   that fine's remaining balance (sums read `FOR SHARE`), or if Σ ≠ `amount_vnd`.
7. Insert the payment (`paid_at = p_now`), then the allocations.
8. Re-sum the allocations from the table; `SIGNAL ALLOCATION_MISMATCH` unless it equals
   `amount_vnd`.
9. `COMMIT`.

`EXIT HANDLER FOR 1062` (a concurrent call with the same key committed first): `ROLLBACK`, then
the same comparison as step 2: return the existing payment with `p_replayed = TRUE`, or
`IDEMPOTENCY_CONFLICT`.

### `sp_checkout` step 0 and step 6b: held copies [Ext]

**Step 0** runs before `START TRANSACTION`, for each requested copy in ascending id: a plain
read finds a `ready` hold on the copy (`WHERE ready_copy_id = copy AND hold_expires_at ≤ p_now`)
and, if there is one, calls `sp__expire_hold` (Internal helpers). That helper expires the hold
and promotes the queue in its own committed transaction (FR-014c "on demand when scanned"), so
the expiry stands even if the checkout is then rejected.

**Step 6b** runs after the policy lock, for each `on_hold` copy in ascending id. The hold is
always looked up by the unique generated column `ready_copy_id`:

1. Lock the copy's `ready` reservation (`WHERE ready_copy_id = copy FOR UPDATE`).
2. Fallback: if `hold_expires_at ≤ p_now` (the hold expired between step 0 and the lock),
   expire it inside the checkout transaction: `status = 'expired'`,
   `close_reason = 'hold_expired'`, `closed_by_kind = 'system'`, `closed_at = p_now`; call
   `sp__promote_queue`; re-read the copy's `ready` reservation `FOR UPDATE`.
3. A `ready` reservation of another reader → `COPY_NOT_AVAILABLE` (held for another reader,
   R-14f); this reader's → remembered for the write step.
4. No `ready` reservation holds the copy: re-read the copy `FOR UPDATE`. Still `on_hold` →
   `COPY_STATE` (broken I-2; the copy is never lent). Otherwise (the promotion made it
   `available`) it is lent as an available copy.

The holder must still pass every eligibility check (a soft-blocked holder gets `DEBT_BLOCKED`,
`OVERDUE_BLOCKED` or `LIMIT_REACHED` and keeps the hold). A rejected checkout does not undo a
step-0 expiry (already committed); only a step-2 fallback expiry rolls back with it. At write time the holder's reservation is set `fulfilled` with
`fulfilled_loan_item_id` = the new loan item, `closed_at = p_now`, `closed_by_kind = 'staff'`,
`closed_by_user_id = p_actor_user_id`, before the copy leaves `on_hold`.

## Internal helpers [not granted]

- `sp__check_replay(p_payment_id, p_reader_id, p_amount_vnd, p_allocations)` raises
  `IDEMPOTENCY_CONFLICT` unless the stored payment has the same reader, amount and exactly the
  same (fine, amount) allocations. Used by `sp_record_payment` (steps 2 and the 1062 handler).
- `sp__assess_fines(p_loan_item_id, p_actor, p_now, p_end_kind, p_damaged_vnd, p_lost_vnd,
  p_reason)` inserts the late fine
  (`fn_late_fee(fn_days_late(due, p_now), applied_fee, replacement_cost)`) when days > 0, and
  the damaged or lost fine with the defaults and range checks of FR-015b. It sets `reason` when
  the amount differs from the default.
- `sp__promote_queue(p_copy_id, p_actor, p_now)` [Ext]: FR-014b promotion walk. It runs inside
  the caller's transaction; the caller holds the book and copy locks and the copy is lendable
  (`available`, or `on_hold` after a hold ended). Callers: `sp_register_copy`,
  `sp_change_copy_status`, `sp_return_item`, `sp_cancel_reservation`, `sp_checkout` (step 6b
  fallback), `sp__expire_hold` (actor `NULL`). Steps:
  1. Lock the book's whole `waiting` queue `FOR UPDATE` in queue order (`reservations_queue_ix`).
  2. Take the head (`ORDER BY requested_at, id`). None left → copy `available` (if not already);
     stop.
  3. Hard eligibility (D4) by **plain reads**: reader `active` and a card `active` with
     `expires_at > p_now`. Readers and cards come before books in the lock order, so they are
     not locked here; checkout re-checks the holder under its own locks, so a stale answer can
     only give a hold that later expires, never a loan.
  4. Hard-ineligible → the head is `cancelled` with `close_reason = 'ineligible_at_promotion'`,
     `closed_by_kind = 'system'`, `closed_at = p_now`; go to step 2. Soft blocks (debt, overdue,
     limit) are not checked.
  5. Eligible → copy `on_hold` (if not already); reservation `ready` with `assigned_copy_id`,
     `ready_at = p_now`, `hold_expires_at = p_now + INTERVAL 3 DAY` (D4 hold window); stop.
- `sp__expire_hold(p_reservation_id, p_now, OUT p_expired)` [Ext]: expires one hold in its own
  transaction. A plain read gets the immutable `book_id` and the `assigned_copy_id` (none → no-op,
  `p_expired = FALSE`); then `START TRANSACTION`, lock book → copy → reservation `FOR UPDATE`,
  and only if the reservation is still `ready` with `hold_expires_at ≤ p_now` set `expired`
  (`close_reason = 'hold_expired'`, `closed_by_kind = 'system'`, `closed_at = p_now`), call
  `sp__promote_queue(copy, NULL, p_now)` and set `p_expired = TRUE`; `COMMIT`. On any error it
  rolls back and re-raises. Callers: `sp__expire_holds_batch`, `sp_checkout` step 0. Not
  granted (errno 1370 for the app account).
- `sp__expire_holds_batch(p_now, OUT p_count)` [Ext]: see Cursor batches. Calling it as the app
  account fails with errno 1370.

## Cursor batches

| Procedure | Tier | Permission | Behaviour |
| --- | --- | --- | --- |
| `sp_expire_cards(p_actor, p_now, OUT p_count)` | Core, public | `card.manage` | Cursor over `library_cards` with `status='active' AND expires_at <= p_now`, ordered by `reader_id, id`. One transaction per row: lock reader → card, re-check, set `expired` |
| `sp_expire_holds(p_actor, p_now, OUT p_count)` | Ext, public | `reservation.manage` | Checks the permission (`FORBIDDEN`), then calls `sp__expire_holds_batch(p_now, p_count)` |
| `sp__expire_holds_batch(p_now, OUT p_count)` | Ext, internal | — | Cursor over `ready` reservations with `hold_expires_at <= p_now`, ordered by `book_id, id`; for each it CALLs `sp__expire_hold(id, p_now, OUT expired)`, so each hold is its own transaction: lock book → copy → reservation `FOR UPDATE` (no reader lock), re-check `ready` and past expiry (a checkout or cancel may have closed it), set `expired`, then `sp__promote_queue(copy, NULL, p_now)`; `p_count` counts expired holds. A hold that hits 1205/1213 is skipped (`sp__expire_hold` rolled it back; the next run or the holder's next scan retries it) and the run continues. Any other error stops the run; holds already committed stay expired |
| `ev_expire_holds` (EVENT) | Ext, not granted | — | `ON SCHEDULE EVERY 15 MINUTE ON COMPLETION PRESERVE ENABLE DO CALL sp__expire_holds_batch(UTC_TIMESTAMP(3), @expired_count)` (FR-014c). Needs `event_scheduler=ON`; `pnpm db:reset-test` disables all events in the test schema because tests pass explicit times |

## Reservation procedures [Ext, public]

| Procedure | Permission | Parameters (after `p_actor_user_id`, `p_now`) | OUT / result | Locks, then writes | Spec |
| --- | --- | --- | --- | --- | --- |
| `sp_reserve` | `reservation.manage`, or the actor is the reader's own `active` account (`readers.user_id`); else `FORBIDDEN` before any lock | reader_id, book_id | `p_reservation_id` | reader `FOR UPDATE` (`NOT_FOUND: reader`; not `active` → `READER_NOT_ACTIVE`) → the reader's `active` cards with `expires_at > p_now` `FOR SHARE` (none → `CARD_INVALID`) → book `FOR UPDATE` (`NOT_FOUND: book`) → the book's `available` copies `FOR SHARE` (any → `VALIDATION`) → the reader's `on_loan` items of the book `FOR SHARE` (any → `VALIDATION`); insert `waiting` with `requested_at = p_now`. A second `waiting`/`ready` reservation for (reader, book) hits `reservations_active_uq` → 1062 → `DUPLICATE`. Lock order reader → card → book → copies. Only a reader who could borrow joins a queue; promotion re-checks both later (D4) | FR-014a, D6, R-14a/g |
| `sp_cancel_reservation` | Checked before `NOT_FOUND`: `reservation.manage` → reason required (else `VALIDATION`) → missing id `NOT_FOUND: reservation` (`closed_by_kind = 'staff'`); otherwise the reservation must exist and belong to the actor's own `active` reader account (`closed_by_kind = 'reader'`, reason optional), else `FORBIDDEN` (a reader account cannot probe ids) | reservation_id, reason | — | plain read of the immutable reader and book, then permission as above; reader → book → reservation `FOR UPDATE`; not `waiting`/`ready` → `INVALID_TRANSITION`; if `ready`, lock the assigned copy `FOR UPDATE`; set `cancelled`, `closed_at = p_now`, `closed_by_user_id = actor`, `close_reason = reason` or `'cancelled_by_reader'` when blank; if it was `ready`, `sp__promote_queue` on the copy | FR-014c, R-14e |

`trg_reservations_bu` (BEFORE UPDATE) allows only `waiting → ready | cancelled` and
`ready → fulfilled | expired | cancelled`, and rejects any change of `reader_id` or `book_id`
(`INVALID_TRANSITION`). Close reasons written by the routines: `ineligible_at_promotion`
(promotion), `hold_expired` (batch and checkout), `cancelled_by_reader` (default on cancel), or
the caller's reason.

## Report procedures [Core, public]

See [reports-and-invariants.md](./reports-and-invariants.md): `sp_report_cumulative(p_as_of,
p_reader_id NULL)` and `sp_report_rollforward(p_from, p_to, p_reader_id NULL)`.
