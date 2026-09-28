/** Small shared helpers (null/undefined handling on top of lodash). */
import {
  isNil,
  isUndefined,
  omitBy,
  pick,
  isString,
  isBoolean,
} from "lodash-es";
export { isNil, isUndefined, pick, isString, isBoolean };

export { cn } from "cn";

/** `fn(value)`, or `null` when the value is `null` or `undefined` (nullable columns, optional fields). */
export function mapNullable<T, R>(
  value: T | null | undefined,
  fn: (v: T) => R,
): R | null {
  return isNil(value) ? null : fn(value);
}

/** A number, or `null` for a `null`/`undefined` column (BIGINT ids and sums may arrive as strings). */
export const toNumberOrNull = (value: unknown): number | null =>
  mapNullable(value, Number);

/** The object without its `null`/`undefined` entries (query strings, optional filters). */
export function omitNil<T extends object>(
  obj: T,
): { [K in keyof T]?: NonNullable<T[K]> } {
  return omitBy(obj, isNil) as { [K in keyof T]?: NonNullable<T[K]> };
}

/** The object without its `undefined` entries; `null` is kept (PATCH: `null` clears a field). */
export function omitUndefined<T extends object>(obj: T): Partial<T> {
  return omitBy(obj, isUndefined) as Partial<T>;
}
