# Backup and restore rehearsal

Rehearsed on 2026-09-24 against the local Docker `mysql:8.4` container, after a fresh volume,
`pnpm db:migrate` and `pnpm db:seed` (constitution: backup/restore rehearsed; tasks T089).

## Commands

```bash
pnpm db:backup      # mysqldump --single-transaction --routines --triggers --events <DB_NAME>
                    # → backups/<DB_NAME>-<timestamp>.sql (git-ignored)
pnpm db:restore     # newest backup → <DB_NAME>_restore: create schema, load dump,
                    # re-apply app grants, run the invariant suite
pnpm db:restore -- --file backups/<file>.sql --into <schema>   # explicit file / target
```

The root password reaches the client tools only through `MYSQL_PWD` inside the container
(`scripts/db/mysql-cli.ts`), never on a command line.

## Output

```text
$ pnpm db:backup
wrote backups/library-2026-09-24T11-56-05-529Z.sql (183 KiB)          0.8 s

$ pnpm db:restore
restored backups/library-2026-09-24T11-56-05-529Z.sql into library_restore
grants on library_restore for library_app: SELECT on 41 objects, write on 11 tables, EXECUTE on 23 routines
library_restore: 9 invariant views, 0 with violations                  1.6 s
```

## Verification

| Check | Result |
| --- | --- |
| `CHECKSUM TABLE` on books, book_copies, loans, loan_items, loan_renewals, fines, fine_adjustments, fine_payments, fine_payment_allocations, library_cards, loan_policies, readers | identical in `library` and `library_restore` |
| Routines / triggers in the restored schema | 24 / 16 (same as source) |
| Invariant suite (`v_inv_*`) on the restored schema | 0 violations |
| `pnpm db:report -- --schema library_restore --month 2026-09` | SC-006 identity and roll-forward hold |
| App account on the restored schema | grants re-applied by `restore.ts`; procedures callable (report ran as the app account) |

## Notes

- Grants are not part of the dump: they name the app account, so `restore.ts` re-applies them
  with `scripts/db/grants.ts` (spec FR-030: migrations and dumps never name accounts).
- Routines keep `DEFINER=root@%` from the source server. A restore onto another server needs
  the same owner account.
- Recovery point = the last backup; there is no binlog point-in-time recovery in this local setup.
