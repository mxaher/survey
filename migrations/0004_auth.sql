-- Authentication: real credentials + server-side sessions.
-- Ported from the fifa2026-vercel auth model:
--   * PBKDF2-SHA256 (100k iterations) password hashes, per-row random salt
--   * opaque random session tokens stored in the database (no signing secret)
--   * rate limiting for login attempts
-- Admin credentials are added to the existing AdminUser table; employees live
-- in their own EmployeeUser table so survey responses stay de-identified
-- (only the HMAC of the employee email ever reaches the responses layer).

ALTER TABLE AdminUser ADD COLUMN passwordHash TEXT;
ALTER TABLE AdminUser ADD COLUMN salt TEXT;

CREATE TABLE IF NOT EXISTS EmployeeUser (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  displayName TEXT,
  department TEXT,
  passwordHash TEXT NOT NULL,
  salt TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 1,
  banned INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Session (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  adminUserId TEXT,
  employeeUserId TEXT,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_Session_expiresAt ON Session(expiresAt);
CREATE INDEX IF NOT EXISTS idx_Session_adminUserId ON Session(adminUserId);
CREATE INDEX IF NOT EXISTS idx_Session_employeeUserId ON Session(employeeUserId);

CREATE TABLE IF NOT EXISTS RateLimit (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  resetAt TEXT NOT NULL
);
