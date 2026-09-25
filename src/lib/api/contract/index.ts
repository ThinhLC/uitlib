/**
 * The API contract shared by the server and the UI (specs/002-library-api, research R2).
 * Imports only zod: safe to use from client components.
 */
export * from './common';
export * from './errors';
export * from './endpoint';
export * from './resources';
export * from './me';
export * from './auth';
export * from './circulation';
export * from './catalog';
export * from './people';
export * from './money';
export * from './reservations';
export * from './reports';
export * from './accounts';

import { meEndpoints } from './me';
import { authEndpoints } from './auth';
import { circulationEndpoints } from './circulation';
import { catalogEndpoints } from './catalog';
import { peopleEndpoints } from './people';
import { moneyEndpoints } from './money';
import { reservationEndpoints } from './reservations';
import { reportEndpoints } from './reports';
import { accountEndpoints } from './accounts';

/** Every endpoint of `/api/v1`, by name. */
export const endpoints = {
  ...meEndpoints,
  ...authEndpoints,
  ...circulationEndpoints,
  ...catalogEndpoints,
  ...peopleEndpoints,
  ...moneyEndpoints,
  ...reservationEndpoints,
  ...reportEndpoints,
  ...accountEndpoints,
};

export type EndpointName = keyof typeof endpoints;
