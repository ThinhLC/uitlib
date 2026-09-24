-- Clauses Drizzle cannot express (tasks T024).
-- Full-text search on book titles (constitution: title/author search columns).
CREATE FULLTEXT INDEX `books_title_ft` ON `books` (`title`, `subtitle`);
