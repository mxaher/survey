-- Self-registration for employee accounts, gated by corporate-domain email
-- verification (per spec: only @almarshad.com mailboxes may hold an account).
--
--   * emailVerified = 0 until the link sent to the mailbox is opened
--   * verifyToken / verifyExpiresAt back the one-time link (24h validity)
--   * admin-created accounts are trusted immediately (backfilled below)

ALTER TABLE EmployeeUser ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE EmployeeUser ADD COLUMN verifyToken TEXT;
ALTER TABLE EmployeeUser ADD COLUMN verifyExpiresAt TEXT;

CREATE INDEX IF NOT EXISTS idx_EmployeeUser_verifyToken ON EmployeeUser(verifyToken);

-- Accounts that already exist were created by an administrator: trust them.
UPDATE EmployeeUser SET emailVerified = 1 WHERE emailVerified = 0;
