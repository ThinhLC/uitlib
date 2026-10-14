# Implementation Plan: Library Frontend (NexusLib Web UI)

**Branch**: `003-library-frontend` | **Date**: 2026-09-25 | **Spec**: [specs/003-library-frontend/spec.md](spec.md)

**Input**: Feature specification from `specs/003-library-frontend/spec.md`

## Summary

Build a modern, unified Next.js 16 App Router Web UI for NexusLib using Tailwind CSS v4, shadcn/ui components (`@base-ui/react`), and Lucide icons.
The frontend covers:
1. **Public Catalog** (`/catalog`, `/books/[id]`): search, category filter, live physical copy availability.
2. **Reader Portal** (`/reader`): loans countdown, due dates, renewals, fine ledger, book reservations.
3. **Circulation Desk** (`/desk`): fast librarian workflow for multi-item checkouts, returns with condition assessment, lost declarations, and cash payments.
4. **Admin Portal** (`/admin`): reader card issuance, borrowing policy review, and monthly debt rollforward & invariant health dashboard.

All data mutations and queries route through the typed API client (`src/lib/api/client.ts`) and contract (`src/lib/api/contract/index.ts`).

---

## Technical Context

- **Language/Framework**: TypeScript 5, Next.js 16.3.6 (App Router, Server & Client Components), React 19.2.8.
- **Styling & Components**: Tailwind CSS v4, shadcn/ui (`@base-ui/react` preset with CSS variables), Lucide icons (`lucide-react`).
- **State & Data Fetching**: React Server Components for initial static data, React hooks + `apiFetch` with caller's Supabase bearer token for interactive client operations.
- **Authentication**: `@supabase/ssr` / `@supabase/supabase-js` for Google sign-in and session cookie storage, synchronized with `GET /api/v1/me` for library RBAC roles.
- **Performance Goals**: First Contentful Paint < 1.0s, debounced search < 300ms, zero layout shift (CLS < 0.1).

---

## Constitution Check

*GATE: Verified against Constitution v1.2.1 Principles I–VII before implementation.*

| Principle | Check | Status |
| :--- | :--- | :--- |
| **I. MySQL Single Source of Truth** | UI never bypasses server API or caches authoritative library data. Every copy status, loan, fine, or card record is fetched live from MySQL via `/api/v1`. | **PASS** |
| **II. Schema-First Constraints** | Input forms use the exact zod schemas defined in `src/lib/api/contract`. | **PASS** |
| **III. Transactional Circulation** | Desk operations (checkout, return, lost, pay) call single-transaction `sp_*` endpoints; no client-side multi-step writes. | **PASS** |
| **IV. Immutable History & Derived Money** | Money formatted as integer VND (đ); UTC timestamps formatted with `date-fns` to local time (`Asia/Ho_Chi_Minh`). | **PASS** |
| **V. Server-Verified Identity & RBAC** | UI components inspect roles from `GET /api/v1/me`. Privileged routes (`/desk`, `/admin`) guard against unauthorized callers client-side and server-side. | **PASS** |
| **VI. Curated External Metadata** | Fallback covers and placeholder badges when Google Books data is incomplete. | **PASS** |
| **VII. Academic Traceability** | Directly satisfies course demonstration requirements for public access, circulation, and reporting. | **PASS** |

---

## Project Structure

```text
src/
├── app/
│   ├── layout.tsx                  # Root layout with Navbar, AuthProvider, and theme wrapper
│   ├── page.tsx                    # Landing page with hero, stats, and quick links
│   ├── catalog/
│   │   ├── page.tsx                # Public book catalog with search, filter, pagination
│   │   └── [id]/page.tsx           # Book details & copy availability
│   ├── reader/
│   │   ├── page.tsx                # Reader dashboard (active loans, due countdowns, fines)
│   │   ├── loans/page.tsx          # Full loan history & renewals
│   │   └── fines/page.tsx          # Fine ledger & payment history
│   ├── desk/
│   │   └── page.tsx                # Librarian Circulation Desk (Checkout, Return, Pay)
│   ├── admin/
│   │   ├── page.tsx                # Admin management overview
│   │   ├── readers/page.tsx        # Reader accounts & card issuance
│   │   └── reports/page.tsx        # Debt rollforward & invariant health check
│   └── dev/auth/                   # Development auth test panel (preserved)
├── components/
│   ├── layout/
│   │   ├── navbar.tsx              # Main navigation header with role badges & user profile
│   │   └── footer.tsx              # Application footer
│   ├── ui/                         # shadcn UI components (button, card, badge, dialog, etc.)
│   ├── catalog/                    # Book cards, search bar, copy status badges
│   ├── desk/                       # Scan inputs, circulation checkout table, return modal
│   └── reader/                     # Loan countdown badges, fine summary card
└── lib/
    ├── api/                        # Typed contract & apiFetch client (from spec 002)
    └── utils.ts                    # cn, mapNullable, formatCurrency, formatDateTime
```

---

## Complexity Tracking

No architectural complexity violations. Everything stays unified within the existing Next.js 16 app without monorepo overhead.
