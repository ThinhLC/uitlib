# Tasks: Library Frontend (NexusLib Web UI)

**Input**: Design documents from `specs/003-library-frontend/` (`spec.md`, `plan.md`)

**Prerequisites**: Spec 001 (MySQL stored procedures), Spec 002 (API contract `/api/v1`)

---

## Phase 1: Setup & Foundational Shell

**Purpose**: Core UI design system, navigation bar, and layout foundations

- [ ] T001 Verify shadcn/ui components (`button`, `card`, `input`, `badge`, `table`, `tabs`, `dialog`, `separator`) and Tailwind CSS v4 variables in `src/app/globals.css`.
- [ ] T002 Implement responsive Navigation Header in `src/components/layout/navbar.tsx` showing brand logo, navigation links (`Catalog`, `Reader`, `Desk`, `Admin`), active role badge, and user profile status.
- [ ] T003 Update root layout in `src/app/layout.tsx` to include `Navbar`, container layout, and responsive footer.

---

## Phase 2: User Story 1 - Public Catalog & Discovery (Priority: P1 - MVP)

**Purpose**: Independent public browsing and searching of library catalog

- [ ] T004 Implement `BookCard` component in `src/components/catalog/book-card.tsx` with cover image fallback, authors list, categories badge, and physical copies availability indicator (`available/total`).
- [ ] T005 Implement Public Catalog Page in `src/app/catalog/page.tsx` with debounced search bar, category dropdown, and paginated grid calling `GET /api/v1/catalog/books`.
- [ ] T006 Implement Book Detail Page in `src/app/catalog/[id]/page.tsx` showing bibliographic metadata, Google Books preview link, and table of physical copies with condition and shelf location.

---

## Phase 3: User Story 2 - Reader Authentication & Borrowing Portal (Priority: P1 - MVP)

**Purpose**: Self-service borrowing portal for authenticated readers

- [ ] T007 Implement Reader Dashboard overview in `src/app/reader/page.tsx` displaying card status, active loans count, overdue alerts, and total outstanding fine balance.
- [ ] T008 Implement Active Loans & Renewals in `src/app/reader/loans/page.tsx` with due date countdown badges (warning if < 3 days, danger if overdue) and action button calling `POST /api/v1/loan-items/{id}/renew`.
- [ ] T009 Implement Fine Ledger in `src/app/reader/fines/page.tsx` displaying itemized assessed fines, payment receipts, and balance calculations.

---

## Phase 4: User Story 3 - Librarian Circulation Desk (Priority: P2)

**Purpose**: Fast operational desk interface for librarians

- [ ] T010 Implement Desk Shell with navigation tabs in `src/app/desk/page.tsx` (Checkout, Returns, Lost, Payments), guarded by `librarian` / `admin` role check.
- [ ] T011 Implement Checkout Flow in `src/components/desk/checkout-panel.tsx`: scan card number (`GET /cards/by-number/...`), scan copy barcodes, validate reader debt status, and execute `POST /loans`.
- [ ] T012 Implement Return & Lost Flow in `src/components/desk/return-panel.tsx`: scan copy barcode, choose condition (`good`, `worn`, `damaged`), enter assessed damage fee, and execute `POST /loan-items/{id}/return` or `POST /loan-items/{id}/lost`.
- [ ] T013 Implement Payment Counter in `src/components/desk/payment-panel.tsx`: select reader, view unpaid fines, record cash payment (`POST /payments`), and show transaction confirmation.

---

## Phase 5: User Story 4 - Admin Management & System Health (Priority: P3)

**Purpose**: Administrative controls, card issuance, and audit reports

- [ ] T014 Implement Reader Management in `src/app/admin/readers/page.tsx` with card issuance modal calling `POST /cards`.
- [ ] T015 Implement Audit & Invariant Dashboard in `src/app/admin/reports/page.tsx` displaying monthly debt rollforward table and real-time database invariant health checks (`GET /api/v1/admin/health`).

---

## Phase 6: Polish & Verification

**Purpose**: Homepage, visual excellence, and end-to-end verification

- [ ] T016 Build modern Hero landing page in `src/app/page.tsx` showcasing catalog highlights, quick circulation statistics, and fast navigation cards.
- [ ] T017 Verify end-to-end workflows with test accounts (`account+student@gmail.com`, `account+librarian@gmail.com`, `account+admin@gmail.com`).
