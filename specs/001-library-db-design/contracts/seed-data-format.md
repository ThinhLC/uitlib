# Contract: Seed Data Files (spec FR-025a/b)

These files are committed under `data/seed/` and read by `scripts/seed/seed.ts`. Seeding never
calls Google Books. It runs only on an empty schema, or with `--reset`, so every run gives the
same result (spec FR-025a).

## `data/seed/isbn-list.txt`

The input to the one-off fetch script. Write one entry per line:
- an ISBN-10 or ISBN-13 (digits only, or with hyphens);
- or a query prefixed `q:` (e.g. `q:intitle:clean code inauthor:martin`), used when a book
  has no ISBN.

Lines starting with `#` are comments. Duplicate entries are an error.

## `data/seed/books.google.json`

Produced once by `scripts/seed/fetch-google-books.ts` (needs `GOOGLE_BOOKS_API_KEY`), then
reviewed and edited by the team before committing.

```jsonc
{
  "fetchedAt": "2026-09-25T03:00:00.000Z",          // when the fetch script ran (UTC)
  "books": [
    {
      "provider": "GOOGLE_BOOKS",
      "externalId": "<volume id>",
      "fetchedAt": "2026-09-25T03:00:12.345Z",
      "reviewed": true,                              // must be true to be seeded
      "book": {
        "title": "…", "subtitle": null,
        "authors": ["…", "…"],                       // order kept
        "publisher": "…", "publishedDateText": "2008-08", "publishedYear": 2008,
        "description": "…", "languageCode": "en", "coverUrl": "https://…",
        "categories": ["…"],
        "identifiers": [{ "type": "ISBN_13", "value": "978…" }]
      },
      "library": {                                   // added by the team, never from Google
        "classificationCode": "005.1 MAR", "replacementCostVnd": 350000,
        "copies": [{ "barcode": "B0001", "shelfCode": "A1-03", "condition": "good" }]
      },
      "access": { "viewability": "PARTIAL", "embeddable": true, "webReaderLink": "https://…", "country": "VN" },
      "raw": { }                                     // the volume JSON as fetched
    }
  ]
}
```

Rules:
- Records with `reviewed` other than `true` are skipped. The seed fails if two records share
  `(provider, externalId)`.
- The seed fails if the same identifier value appears on two records that are not marked
  `"distinctEditionOf": "<externalId>"`. This follows FR-003: no silent merge; the team confirms
  that the two are different editions.

## `data/seed/books.manual.json`

Same `book` and `library` shape, without `provider`, `externalId`, `access` or `raw`. It MUST
include at least one book with no identifiers and one with no `coverUrl` (FR-025).

## `data/seed/people.json`

- **Accounts**: the five real Supabase test users `account+admin|librarian|student|lecturer|external@gmail.com`
  (spec 002), linked to S01 (STUDENT), L01 (LECTURER) and E01 (EXTERNAL), plus sample accounts
  with fake Supabase ids (`00000000-0000-4000-8000-…`) that cannot sign in: a second librarian
  (also holding the `reader` role), an `inactive` former librarian, five reader accounts and one
  account with no reader record yet.
- **Readers**: `key`, reader type code, name, contacts, status and an optional account link.
  15 readers cover every reader type and status (`active`, `suspended`, `inactive`), with and
  without an account, email or phone. Readers without an account are served at the desk.

## Scenario script (in `scripts/seed/seed.ts`, not a data file)

A time-ordered list of procedure calls with explicit `p_now` values (UTC). Example steps:
`sp_create_policy_version`, `sp_close_policy_version`, `sp_issue_card`, `sp_set_card_status`,
`sp_expire_cards`, `sp_register_copy`, `sp_change_copy_status`, `sp_checkout`, `sp_renew`,
`sp_return_item`, `sp_declare_lost`, `sp_record_payment`, `sp_adjust_fine`, `sp_reserve`,
`sp_cancel_reservation`, `sp_expire_holds`.

The script covers the [Core] and [Ext] cases of spec FR-025, including the expired card and the
ineligible queue head, the US2-10 checkout at 2026-09-30 23:59:59.900 local and the US4-14 fine
assessed in September and paid in October. It also runs calls that a business rule must reject
(`rejected(KEY, …)`), one per error key where the seed can show it. The scenario is sized so that
every non-catalog data table (accounts, readers, cards, policies, loans, renewals, reservations,
fines, adjustments, payments, allocations) holds 10–20 rows (course requirement). The catalog
tables follow the full `books.manual.json` and hold more; `book_external_refs` stays empty until
`books.google.json` is reviewed. Reservation queues use one-copy books (SICP, Code Complete,
Domain-Driven Design, the SQL handout) and Truyện Kiều, whose second copy is in repair, because
a book with an available copy cannot be reserved. Each step names the scenario it demonstrates, so the report can
cite it.
