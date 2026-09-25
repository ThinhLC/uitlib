/**
 * The library's time zone (spec 001 FR-022). Vietnam has had no DST since 1975, so this matches
 * the fixed UTC+07:00 offset the database uses in `fn_local_date`.
 */
export const LIBRARY_TIME_ZONE = 'Asia/Ho_Chi_Minh';
