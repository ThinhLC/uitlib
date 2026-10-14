# Feature Specification: Library Frontend (NexusLib Web UI)

**Feature Branch**: `003-library-frontend`

**Created**: 2026-09-25

**Status**: Ready for Planning

**Input**: User description: "làm frontend với shadcn, spec driven development"

## Context

Spec 001 delivered the database (schema, stored procedures, triggers, invariants).
Spec 002 delivered the typed HTTP API contract (`src/lib/api/contract`) and Hono routes mounted at `/api/v1` with Supabase Auth verification.

Spec 003 delivers the **complete Web Application UI (Frontend)** for NexusLib.
It connects end users (readers, librarians, system administrators) to the library through a rich, modern, responsive interface built with Next.js 16 (App Router), Tailwind CSS v4, shadcn/ui components (`@base-ui/react`), and Lucide icons.

The UI consumes the typed API contract exclusively via `apiFetch` using the caller's Supabase session access token. It contains zero direct database access, respecting the Constitution's separation of concerns (Principle I, V).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Public Catalog Discovery & Search (Priority: P1 - MVP)

As any visitor or library member (anonymous or signed in),
I want to search and browse cataloged books with live physical copy availability,
So that I can discover books and know if copies are currently available on the shelf before visiting.

**Why this priority**:
The catalog is the primary entry point for all users. It requires no authentication and showcases the inventory immediately.

**Independent Test**:
Can be fully tested by visiting `/` or `/catalog`, searching for keywords (e.g. "Clean", "Database"), filtering by categories, and opening a book detail page showing available copy counts and shelf locations.

**Acceptance Scenarios**:
1. **Given** the user navigates to `/catalog`, **When** the page loads, **Then** a grid/list of books is displayed with cover image, title, authors, categories, and availability badge (e.g., `3/3 available` or `0/1 available`).
2. **Given** a user inputs a search keyword into the search bar, **When** they type or press Enter, **Then** the book list updates via `GET /api/v1/catalog/books?q=...` without full page reloads.
3. **Given** a user clicks on a book card, **When** navigating to `/catalog/[id]`, **Then** full bibliographic details, description, replacement cost, and copy status list are presented.

---

### User Story 2 - Reader Authentication & Borrowing Portal (Priority: P1 - MVP)

As an authenticated library reader (student, lecturer, external),
I want to view my active loans, due dates, countdown alerts, and fine balance,
So that I can return books on time, track renewals, and pay outstanding fees.

**Why this priority**:
Self-service transparency prevents overdue fines and allows readers to monitor their borrowing privileges.

**Independent Test**:
Sign in with a seeded test account (e.g. `account+student@gmail.com`) or Google OAuth. Navigate to `/reader`. Verify that current active loans, due dates, renewal button, and outstanding fines match the seeded database state.

**Acceptance Scenarios**:
1. **Given** a signed-in reader with active loans, **When** visiting `/reader/loans`, **Then** all borrowed items appear with due date countdown badges (e.g., "Due in 3 days", "Overdue by 2 days" in red).
2. **Given** an eligible open loan item, **When** the reader clicks "Renew", **Then** the UI calls `POST /api/v1/loan-items/{id}/renew` and updates the due date or displays the rejection reason (e.g., `RENEWAL_REJECTED` if limits reached or reserved).
3. **Given** a reader with assessed fines, **When** visiting `/reader/fines`, **Then** an itemized ledger of overdue/damaged fines and payments is shown.
4. **Given** all copies of a book are on loan, **When** an eligible reader views the book, **Then** a "Reserve Book" button is enabled; clicking calls `POST /api/v1/reservations`.

---

### User Story 3 - Librarian Circulation Desk (Priority: P2)

As a librarian on duty,
I want a dedicated circulation desk interface to quickly process checkouts, returns, damage assessments, and fine payments,
So that desk operations are rapid, audit-logged, and enforced by the database stored procedures.

**Why this priority**:
Core daily operations of physical library desks. Essential for circulation staff.

**Independent Test**:
Sign in as a librarian (`account+librarian@gmail.com`). Access `/desk`. Scan reader card `C2026-0001`, add copy barcode `M001`, and execute checkout. Then process a return with condition inspection.

**Acceptance Scenarios**:
1. **Checkout**:
   - **Given** librarian enters a Reader Card number (`C2026-0001`), **When** validated via `GET /api/v1/cards/by-number/...`, **Then** reader info, active loans count, and debt block status are displayed.
   - **Given** one or more valid copy barcodes are added, **When** clicking "Confirm Checkout", **Then** `POST /api/v1/loans` is dispatched and due date receipts are shown.
2. **Returns & Lost Declaration**:
   - **Given** a returned copy barcode, **When** looking up open loan item, **Then** librarian selects condition (`good`, `worn`, `damaged`) and optional damage fee.
   - **Given** confirmed return, **When** calling `POST /api/v1/loan-items/{id}/return`, **Then** the return is committed and newly assessed fines (if overdue/damaged) are displayed immediately.
   - **Given** reader reports a lost book, **When** clicking "Declare Lost", **Then** `POST /api/v1/loan-items/{id}/lost` is executed with reason notes.
3. **Payment Counter**:
   - **Given** reader with unpaid fines, **When** collecting cash at desk, **Then** librarian enters payment amount, selects fine allocations, and commits via `POST /api/v1/payments`.

---

### User Story 4 - Admin Management & System Health (Priority: P3)

As a library administrator,
I want to manage reader accounts, issue new library cards, view policy versions, and check system invariants,
So that library policies remain compliant and database health is monitored in real-time.

**Why this priority**:
High-privilege maintenance, reporting, and audit verification.

**Independent Test**:
Sign in as admin (`account+admin@gmail.com`). Access `/admin`. Review readers list, issue a card to an uncarded reader, inspect borrowing policy parameters, and verify the invariant dashboard shows 0 violations.

**Acceptance Scenarios**:
1. **Given** admin navigates to `/admin/readers`, **When** clicking "Issue Card", **Then** dialog prompts for barcode number and expiration date, calling `POST /api/v1/cards`.
2. **Given** admin navigates to `/admin/reports`, **When** selecting month `2026-10`, **Then** the debt rollforward table renders opening, assessed, adjusted, collected, and closing balances from `GET /api/v1/reports/debt/rollforward`.
3. **Given** admin views system health, **When** loading `/admin/health`, **Then** all `v_inv_*` checks display green passing status.

---

## Edge Cases

- **Session Expiry**: When an access token expires while browsing, the API client catches 401, triggers token refresh via Supabase client, and retries the request seamlessly.
- **Debt Blocking**: When a reader with debt tries to checkout or collect a reserved book, the UI clearly displays the blocking reason and directs them to the payment counter.
- **Copy Unavailable**: If another user borrows a copy concurrently, the UI receives 409 `COPY_NOT_AVAILABLE` and prompts the user to refresh catalog availability.
- **Missing Covers**: Fallback to SVG placeholder with genre-themed gradient when `cover_url` is missing or fails to load.
- **Dark Mode**: Fully supported via Tailwind CSS v4 and CSS variables for high contrast in library low-light environments.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a responsive Navigation Header displaying brand logo, navigation links, theme toggle, and authenticated user profile with role badge.
- **FR-002**: Public catalog MUST support text search (`q`), category filtering, and paginated results (`page`, `pageSize`).
- **FR-003**: Book Detail page MUST display catalog metadata and real-time physical copy availability count.
- **FR-004**: Authentication MUST support Google OAuth sign-in and dev password sign-in against Supabase Auth.
- **FR-005**: Reader portal MUST present active loans, return countdowns, renewal triggers, reservation status, and unpaid fine ledger.
- **FR-006**: Desk interface MUST restrict access to users holding the `librarian` or `admin` role.
- **FR-007**: Desk interface MUST support multi-item checkout, item return with condition assessment, and cash payment recording.
- **FR-008**: Admin portal MUST restrict access to users holding the `admin` role.
- **FR-009**: Admin portal MUST display the monthly debt rollforward report and invariant health check status.
- **FR-010**: All UI state changes invoking mutations MUST provide clear visual feedback via toast notifications and loading skeletons.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Catalog search responds and updates results within 300ms of user input (debounced).
- **SC-002**: Circulation desk can complete a checkout flow for 3 books in under 15 seconds.
- **SC-003**: 100% of API error codes from spec 002 (`DEBT_BLOCKED`, `COPY_NOT_AVAILABLE`, `CARD_EXPIRED`, etc.) map to human-friendly Vietnamese/English alert messages.
- **SC-004**: Lighthouse Accessibility & Best Practices score on public pages >= 90.
