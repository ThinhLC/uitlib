import { z } from 'zod';
import { Id, OptionalText, PageQuery, type Instant, type Page } from './common';
import { defineEndpoint } from './endpoint';
import type { BookRef, ReservationStatus } from './resources';

/** Contract: US6 reservations and holds (tasks T061; data-model.md "Reservations"). */

export const RESERVATION_STATUSES = ['waiting', 'ready', 'fulfilled', 'cancelled', 'expired'] as const;

/** A reservation (hold request) for a book [Ext in spec 001]. */
export interface Reservation {
  id: number;
  readerId: number;
  book: BookRef;
  status: ReservationStatus;
  requestedAt: Instant;
  /** 1-based place among the book's `waiting` reservations; `null` unless waiting. */
  queuePosition: number | null;
  readyAt: Instant | null;
  holdExpiresAt: Instant | null;
  assignedCopyId: number | null;
  closedAt: Instant | null;
  closeReason: string | null;
}

/** Readers pass their own `readerId`; the procedure decides FORBIDDEN. */
export const ReserveInput = z.strictObject({ readerId: Id, bookId: Id });

/** `reason` is required for staff (the procedure answers VALIDATION); the column holds 64 characters. */
export const CancelReservationInput = z.strictObject({ reason: OptionalText(64) });

export const ReservationsQuery = PageQuery.extend({
  status: z.enum(RESERVATION_STATUSES).optional(),
  bookId: Id.optional(),
});

export const ReaderReservationsQuery = PageQuery.extend({
  status: z.enum(RESERVATION_STATUSES).optional(),
});

export interface ExpireHoldsResult {
  count: number;
}

export const reservationEndpoints = {
  /**
   * Reserve a book (`sp_reserve`). Signed-in; the procedure allows the reader's own account or
   * `reservation.manage`. 201 Reservation.
   * Errors: FORBIDDEN, NOT_FOUND (reader, book), READER_NOT_ACTIVE, CARD_INVALID,
   * VALIDATION (a copy is available, or the reader has the book on loan),
   * DUPLICATE `reservations_active_uq`.
   */
  reserve: defineEndpoint<Reservation>()({
    method: 'POST',
    path: '/reservations',
    body: ReserveInput,
    access: { kind: 'procedure' },
    procedure: 'sp_reserve',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'READER_NOT_ACTIVE', 'CARD_INVALID', 'VALIDATION', 'DUPLICATE'],
  }),
  /**
   * Cancel a waiting or ready reservation (`sp_cancel_reservation`); a ready hold passes its copy to
   * the next reader. Signed-in; the procedure allows the owner or `reservation.manage` (staff must
   * give a reason). 200 Reservation.
   * Errors: FORBIDDEN, NOT_FOUND (reservation), VALIDATION (staff without reason), INVALID_TRANSITION.
   */
  cancelReservation: defineEndpoint<Reservation>()({
    method: 'POST',
    path: '/reservations/:reservationId/cancel',
    params: z.object({ reservationId: Id }),
    body: CancelReservationInput,
    access: { kind: 'procedure' },
    procedure: 'sp_cancel_reservation',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'INVALID_TRANSITION'],
  }),
  /**
   * A reader's reservations, newest first. Self or `reservation.manage`; anyone else gets
   * NOT_FOUND. Errors: NOT_FOUND (reader).
   */
  readerReservations: defineEndpoint<Page<Reservation>>()({
    method: 'GET',
    path: '/readers/:readerId/reservations',
    params: z.object({ readerId: Id }),
    query: ReaderReservationsQuery,
    access: { kind: 'self-or', any: ['reservation.manage'], readerParam: 'readerId' },
    errors: ['NOT_FOUND'],
  }),
  /**
   * Every reservation, in queue order (`status=ready` is the hold shelf). `reservation.manage`.
   * Errors: FORBIDDEN.
   */
  listReservations: defineEndpoint<Page<Reservation>>()({
    method: 'GET',
    path: '/reservations',
    query: ReservationsQuery,
    access: { kind: 'perm', any: ['reservation.manage'] },
    errors: ['FORBIDDEN'],
  }),
  /**
   * Expire overdue holds now (`sp_expire_holds`); the database event keeps doing it on schedule.
   * `reservation.manage`. 200 `{count}`. Errors: FORBIDDEN.
   */
  expireHolds: defineEndpoint<ExpireHoldsResult>()({
    method: 'POST',
    path: '/jobs/expire-holds',
    access: { kind: 'perm', any: ['reservation.manage'] },
    procedure: 'sp_expire_holds',
    errors: ['FORBIDDEN'],
  }),
};
