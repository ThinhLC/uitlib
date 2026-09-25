import type { Access } from '@/lib/api/contract';
import { ApiError } from '@/server/api/errors/api-error';
import type { Caller } from '@/server/api/context';
import { isNil } from '@/lib/utils';

export const holdsAny = (caller: Caller, perms: readonly string[]) => perms.some((p) => caller.permissions.has(p));

/**
 * Server-side access check after authentication (FR-009, FR-010). `self-or` answers NOT_FOUND to
 * anyone but the reader or a permission holder, the same as for a missing id.
 */
export function enforceAccess(access: Access, caller: Caller | undefined, params: Record<string, unknown>): void {
  switch (access.kind) {
    case 'perm':
      if (!caller || !holdsAny(caller, access.any)) throw new ApiError('FORBIDDEN', access.any[0]);
      return;
    case 'self-or': {
      if (!caller) throw new ApiError('NOT_FOUND', 'reader');
      const own = !isNil(caller.readerId) && Number(params[access.readerParam]) === caller.readerId;
      if (!own && !holdsAny(caller, access.any)) throw new ApiError('NOT_FOUND', 'reader');
      return;
    }
    default:
      return;
  }
}

/** True when the caller may see any reader's records for this access rule (not just their own). */
export function isStaffFor(access: Access, caller: Caller): boolean {
  return access.kind === 'self-or' ? holdsAny(caller, access.any) : true;
}
