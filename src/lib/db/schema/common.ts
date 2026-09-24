import { bigint, datetime } from 'drizzle-orm/mysql-core';

/** BIGINT surrogate primary key (constitution II). */
export const id = () => bigint('id', { mode: 'number' }).autoincrement().primaryKey();

/** BIGINT foreign-key / money column. */
export const big = (name: string) => bigint(name, { mode: 'number' });

/** DATETIME(3) holding UTC, returned as 'YYYY-MM-DD HH:MM:SS.mmm' (research R9). */
export const ts = (name: string) => datetime(name, { mode: 'string', fsp: 3 });
