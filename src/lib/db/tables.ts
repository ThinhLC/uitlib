// Barrel of all 27 tables for application code (specs/001-library-db-design/data-model.md).
// It lives outside ./schema on purpose: drizzle-kit loads every file in the schema folder, and a
// re-export inside that folder would register each table twice ("PK conflict").
export * from './schema/catalog';
export * from './schema/people';
export * from './schema/policies';
export * from './schema/circulation';
export * from './schema/fines';
