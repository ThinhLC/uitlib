import type { Instant } from './common';

/**
 * Resource shapes shared by several areas (data-model.md "Resources"). Area modules import these
 * instead of redefining them.
 */

export type CopyCondition = 'good' | 'worn' | 'damaged';
export type CirculationStatus = 'available' | 'on_loan' | 'on_hold' | 'in_repair' | 'lost' | 'retired';
export type ReaderStatus = 'active' | 'suspended' | 'inactive';
export type CardStatus = 'active' | 'expired' | 'lost' | 'revoked';
export type LoanItemStatus = 'on_loan' | 'returned' | 'lost';
export type FineType = 'late' | 'damaged' | 'lost';
export type ReservationStatus = 'waiting' | 'ready' | 'fulfilled' | 'cancelled' | 'expired';

export interface BookRef {
  id: number;
  title: string;
}

/** A physical copy, staff view (no public route returns it). */
export interface Copy {
  id: number;
  bookId: number;
  barcode: string;
  shelfCode: string | null;
  /** `YYYY-MM-DD` */
  acquiredAt: string | null;
  physicalCondition: CopyCondition;
  circulationStatus: CirculationStatus;
  /** Set while the copy is `on_hold`. */
  heldFor: { reservationId: number; readerId: number; holdExpiresAt: Instant } | null;
}

export interface Card {
  id: number;
  readerId: number;
  cardNumber: string;
  issuedAt: Instant;
  expiresAt: Instant;
  status: CardStatus;
  /** `active` and `expiresAt` after the server's now. */
  validNow: boolean;
}

export interface Reader {
  id: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  /** Reader type code, e.g. `STUDENT`. */
  readerType: string;
  status: ReaderStatus;
  accountId: number | null;
  createdAt: Instant;
  activeCard: Card | null;
}

/** A fine as listed on a loan item. */
export interface FineRef {
  id: number;
  type: FineType;
  amountVnd: number;
}
