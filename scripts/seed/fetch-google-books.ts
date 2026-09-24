/**
 * One-off fetch of sample book metadata from Google Books (spec FR-025a, research R13, tasks T080).
 * Usage: pnpm exec tsx scripts/seed/fetch-google-books.ts [--force]
 *
 * Reads data/seed/isbn-list.txt, looks each entry up, fetches `volumes/{id}` and writes
 * data/seed/books.google.json with `reviewed: false` and `library: null`. The team reviews and
 * edits that file before committing it; seeding never calls Google Books.
 * GOOGLE_BOOKS_API_KEY is optional but anonymous quota is small.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });

const LIST = 'data/seed/isbn-list.txt';
const OUT = 'data/seed/books.google.json';
const API = 'https://www.googleapis.com/books/v1';

interface Volume {
  id: string;
  selfLink?: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    language?: string;
    categories?: string[];
    imageLinks?: Record<string, string>;
    industryIdentifiers?: { type: string; identifier: string }[];
  };
  accessInfo?: { viewability?: string; embeddable?: boolean; webReaderLink?: string; country?: string };
}

/** Entries of the list file: ISBNs (hyphens allowed) or `q:` queries; `#` starts a comment. */
export function parseList(text: string): string[] {
  const entries = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => (l.startsWith('q:') ? l : l.replace(/-/g, '')));
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.startsWith('q:') && !/^(\d{9}[\dX]|\d{13})$/.test(e)) throw new Error(`${LIST}: not an ISBN: ${e}`);
    if (seen.has(e)) throw new Error(`${LIST}: duplicate entry ${e}`);
    seen.add(e);
  }
  return entries;
}

const VIEWABILITY = new Set(['PARTIAL', 'ALL_PAGES', 'NO_PAGES']);

/** Map a Google volume to the contracts/seed-data-format.md record (not yet reviewed). */
export function toRecord(v: Volume, fetchedAt: string) {
  const info = v.volumeInfo ?? {};
  const year = /^(\d{4})/.exec(info.publishedDate ?? '')?.[1];
  const cover = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
  return {
    provider: 'GOOGLE_BOOKS',
    externalId: v.id,
    fetchedAt,
    reviewed: false,
    book: {
      title: info.title ?? '',
      subtitle: info.subtitle ?? null,
      authors: info.authors ?? [],
      publisher: info.publisher ?? null,
      publishedDateText: info.publishedDate?.slice(0, 10) ?? null,
      publishedYear: year ? Number(year) : null,
      description: info.description ?? null,
      languageCode: info.language ?? null,
      coverUrl: cover?.replace(/^http:/, 'https:') ?? null,
      categories: info.categories ?? [],
      identifiers: (info.industryIdentifiers ?? [])
        .filter((i) => i.type === 'ISBN_10' || i.type === 'ISBN_13')
        .map((i) => ({ type: i.type, value: i.identifier })),
    },
    library: null,
    access: {
      viewability: VIEWABILITY.has(v.accessInfo?.viewability ?? '') ? v.accessInfo!.viewability : 'UNKNOWN',
      embeddable: v.accessInfo?.embeddable ?? null,
      webReaderLink: v.accessInfo?.webReaderLink ?? null,
      country: v.accessInfo?.country ?? null,
    },
    raw: v,
  };
}

async function getJson<T>(url: string): Promise<T> {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  const full = key ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}` : url;
  const res = await fetch(full);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

async function main() {
  if (existsSync(OUT) && !process.argv.includes('--force')) {
    throw new Error(`${OUT} exists (it may hold the team's review); pass --force to overwrite`);
  }
  const entries = parseList(readFileSync(LIST, 'utf8'));
  const books: ReturnType<typeof toRecord>[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const q = entry.startsWith('q:') ? entry.slice(2) : `isbn:${entry}`;
    const found = await getJson<{ items?: Volume[] }>(`${API}/volumes?q=${encodeURIComponent(q)}&maxResults=1`);
    const hit = found.items?.[0];
    if (!hit) {
      console.warn(`not found: ${entry}`);
      continue;
    }
    if (ids.has(hit.id)) {
      console.warn(`duplicate volume ${hit.id} for ${entry}; skipped`);
      continue;
    }
    ids.add(hit.id);
    const volume = await getJson<Volume>(`${API}/volumes/${hit.id}`);
    books.push(toRecord(volume, new Date().toISOString()));
    console.log(`${entry} → ${hit.id} ${volume.volumeInfo?.title ?? ''}`);
  }
  writeFileSync(OUT, `${JSON.stringify({ fetchedAt: new Date().toISOString(), books }, null, 2)}\n`);
  console.log(`wrote ${OUT}: ${books.length}/${entries.length} records, all reviewed=false`);
}

if (process.argv[1]?.endsWith('fetch-google-books.ts')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
