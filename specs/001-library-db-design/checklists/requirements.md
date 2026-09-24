# Specification Quality Checklist: Core Library Data Model and ERD

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-24 (revalidated after revision 6, 2026-09-24)
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — *intentionally waived, see Notes*
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders — user stories are; the Concurrency Protocol and
      Rule Enforcement Matrix are for the technical team
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded — [Core]/[Ext] tiers on every FR, scenario, matrix row and test
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification — *waived for the technical sections,
      see Notes*

## Notes

- **Waiver.** At the team's request (reviews of 2026-09-24), the spec names MySQL, Drizzle,
  Supabase Auth and Google Books and states enforcement mechanisms. The "no implementation
  details" items are deliberately waived for the Revision note, Concurrency Protocol, Rule
  Enforcement Matrix, FR-016a–c, FR-019/019a and Assumptions. User stories and success criteria
  stay technology-neutral.
- **Revision 3 changes** (second review):
  1. Payment: FR-016a defines the single write path (record-payment procedure plus privilege
     revocation) and the step that re-checks Σ allocations = amount before COMMIT. FR-016c
     states the guarantee boundary: it holds for the application account, not for privileged
     accounts, so R-16b is classed "Procedure + privileges", not "DB". FR-016b adds a request
     key for safe retries. New scenarios US4-12 and US4-13, and bypass test B-2.
  2. Policy `valid_to`: FR-009b/c. A version governs only checkout; loans outlive it. Closing
     must be non-retroactive and after every referencing borrow time. The old wording allowed
     `valid_to` = borrow time, which breaks the half-open interval; this is fixed. Boundary
     example in US2-10, retroactive closing in US2-8, invariant I-9, test CT-6.
  3. Concurrency: new Concurrency Protocol section with a global lock order, per-flow lock
     sequences (checked by script to be subsequences of the global order), and rollback and retry
     rules for errors 1213 and 1205 (1205 needs an explicit ROLLBACK). Tests CT-1…CT-13, where
     CT-4…CT-6 and CT-9…CT-13 interleave different flows; bypass tests B-1…B-5.
  4. Queue head: FR-014b–d. Hard-ineligible readers are cancelled at promotion; soft-ineligible
     readers keep the hold window, then expire. The queue stalls at most one hold window per
     soft-ineligible reader. Scenario US3-15.
  5. Scope tiers: [Core]/[Ext] defined up front and applied everywhere. Reservations,
     adjustments, import refresh with accept, and preview are [Ext]; their single-row
     constraints stay in the [Core] schema.
- **Revision 4 changes** (third review):
  1. FR-018: the identity *net assessed = collected + outstanding* now applies only to
     cumulative balances as of an instant. Period reports show opening balance, assessed in
     period, adjustments in period, collected in period and closing balance, linked by a
     roll-forward. Added scenario US4-14 (fine assessed in September, paid in October), a
     matching FR-025 sample case, and an updated SC-006.
  2. Concurrency Protocol: the lock order is now described as a convention that reduces deadlock
     risk, not a proof. It lists the implicit InnoDB locks (DML, unique/FK checks, triggers,
     gap/next-key locks) and relies on rollback/retry plus the CT tests and invariant suite.
  3. Assumptions: the plan must start with an early spike on the target MySQL version
     (procedure with an allocation list, generated-column unique indexes, CHECK, triggers,
     EXECUTE-only account) and must finish [Core] before starting [Ext].
- **Revision 6 changes** (analysis 2026-09-24):
  - F2: import refresh and online preview relabelled [API].
  - F3: a damaged copy is registered as `in_repair`.
  - U1: adjustments moved to [Core].
  - C2: report chapters stated.
  - F4: CT-3 wording.
  - E1: RS-1 reservation schema test.
  - A1: seeding runs only on an empty schema.
  - FR-030 (new): no hard-coded names or secrets; everything comes from env with generic
    defaults. Constitution amended to v1.2.0 to allow a versioned grants script instead of
    grants in migrations.
- **Scope of this checklist.** Passing items means the *document* is complete and consistent.
  It does not show that the MySQL mechanisms work; that is proven only by the spike and the
  tests defined in the spec.
- **Traceability.** A script verified that every scenario id (USx-y), CT and B referenced
  anywhere in the spec is defined, and that no [NEEDS CLARIFICATION] markers remain.
- FR-023 is structural and is verified by US6 and SC-001 (data dictionary review).
- Open decisions D1–D13 keep defaults; none changes the entity structure. D11 (payment write
  path) and D12 (extension commitment) are the ones that change the amount of work.
