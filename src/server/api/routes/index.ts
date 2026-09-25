import type { Hono } from 'hono';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { registerMeta } from './meta';
import { registerAuthRedirects } from './auth-redirects';
import { registerSignupHook } from './signup-hook';
import { registerLoans } from './loans';
import { registerPublicCatalog } from './public-catalog';
import { registerCatalog } from './catalog';
import { registerCopies } from './copies';
import { registerReaders } from './readers';
import { registerCards } from './cards';
import { registerPolicies } from './policies';
import { registerMoney } from './money';
import { registerReservations } from './reservations';
import { registerReports } from './reports';
import { registerAccounts } from './accounts';

export type RouteModule = (app: Hono<AppEnv>, deps: ApiDeps) => void;

/** Every route module of `/api/v1`, in registration order. */
export const routeModules: RouteModule[] = [
  registerMeta,
  registerSignupHook,
  registerAuthRedirects,
  registerLoans,
  registerPublicCatalog,
  registerCatalog,
  registerCopies,
  registerReaders,
  registerCards,
  registerPolicies,
  registerMoney,
  registerReservations,
  registerReports,
  registerAccounts,
];
