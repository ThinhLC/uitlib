import { handle } from 'hono/vercel';
import { createApp } from '@/server/api/app';
import { productionDeps } from '@/server/api/deps';

// mysql2 needs Node; the edge runtime is deprecated in Next 16 (research R1).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const app = createApp(productionDeps());

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
