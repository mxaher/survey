-- Almarshad Holding — Anonymous Arabic Employee Survey & Executive Evaluation Platform
-- D1 Migration: Initial Schema
-- Converted from Prisma schema (prisma/schema.prisma)

-- ============================================================
-- CAMPAIGNS — 5-state lifecycle: draft → scheduled → active → closed → archived
-- ============================================================
CREATE TABLE IF NOT EXISTS Campaign (
  id TEXT PRIMARY KEY,
  titleAr TEXT NOT NULL,
  descriptionAr TEXT,
  instructionsAr TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  startsAt TEXT,
  endsAt TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  minimumReportingThreshold INTEGER NOT NULL DEFAULT 5,
  enableEnvironmentSurvey INTEGER NOT NULL DEFAULT 1,
  enableFutureSurvey INTEGER NOT NULL DEFAULT 1,
  allowMultipleExecutiveEvaluations INTEGER NOT NULL DEFAULT 1,
  minExecutives INTEGER,
  maxExecutives INTEGER,
  allowResume INTEGER NOT NULL DEFAULT 1,
  privacyNoticeAr TEXT,
  activatedAt TEXT,
  closedAt TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_Campaign_status ON Campaign(status);

-- ============================================================
-- EXECUTIVES — global registry, assignable per campaign
-- ============================================================
CREATE TABLE IF NOT EXISTS Executive (
  id TEXT PRIMARY KEY,
  nameAr TEXT NOT NULL,
  titleAr TEXT NOT NULL,
  category TEXT NOT NULL,
  departmentAr TEXT,
  displayOrder INTEGER NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  deletedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_Executive_isActive ON Executive(isActive);

-- ============================================================
-- CAMPAIGN EXECUTIVE — M:N join table
-- ============================================================
CREATE TABLE IF NOT EXISTS CampaignExecutive (
  campaignId TEXT NOT NULL,
  executiveId TEXT NOT NULL,
  displayOrder INTEGER NOT NULL DEFAULT 0,
  isEnabled INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (campaignId, executiveId),
  FOREIGN KEY (campaignId) REFERENCES Campaign(id) ON DELETE CASCADE,
  FOREIGN KEY (executiveId) REFERENCES Executive(id) ON DELETE CASCADE
);

-- ============================================================
-- QUESTION LIBRARY — reusable; admin selects subset per campaign
-- ============================================================
CREATE TABLE IF NOT EXISTS Question (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  questionAr TEXT NOT NULL,
  questionType TEXT NOT NULL,
  section TEXT NOT NULL,
  dimension TEXT,
  isRequired INTEGER NOT NULL DEFAULT 1,
  displayOrder INTEGER NOT NULL DEFAULT 0,
  maxSelections INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  parentQuestionId TEXT,
  isCurrent INTEGER NOT NULL DEFAULT 1,
  isActive INTEGER NOT NULL DEFAULT 1,
  deletedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_Question_section ON Question(section);
CREATE INDEX IF NOT EXISTS idx_Question_isActive ON Question(isActive);

-- ============================================================
-- QUESTION OPTION — answer options per question
-- ============================================================
CREATE TABLE IF NOT EXISTS QuestionOption (
  id TEXT PRIMARY KEY,
  questionId TEXT NOT NULL,
  value TEXT NOT NULL,
  labelAr TEXT NOT NULL,
  score REAL,
  displayOrder INTEGER NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (questionId) REFERENCES Question(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_QuestionOption_questionId ON QuestionOption(questionId);

-- ============================================================
-- CAMPAIGN QUESTION CONFIG — per-campaign assignment, scope, required flag, order
-- ============================================================
CREATE TABLE IF NOT EXISTS CampaignQuestionConfig (
  campaignId TEXT NOT NULL,
  questionId TEXT NOT NULL,
  scope TEXT NOT NULL,
  isRequired INTEGER NOT NULL DEFAULT 1,
  displayOrder INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (campaignId, questionId),
  FOREIGN KEY (campaignId) REFERENCES Campaign(id) ON DELETE CASCADE,
  FOREIGN KEY (questionId) REFERENCES Question(id) ON DELETE CASCADE
);

-- ============================================================
-- IMMUTABLE SNAPSHOTS — frozen at activation; responses reference these
-- ============================================================
CREATE TABLE IF NOT EXISTS CampaignQuestionSnapshot (
  id TEXT PRIMARY KEY,
  campaignId TEXT NOT NULL,
  originalQuestionId TEXT NOT NULL,
  questionCode TEXT NOT NULL,
  questionAr TEXT NOT NULL,
  questionType TEXT NOT NULL,
  section TEXT NOT NULL,
  dimension TEXT,
  isRequired INTEGER NOT NULL,
  displayOrder INTEGER NOT NULL,
  maxSelections INTEGER,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (campaignId) REFERENCES Campaign(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_CampaignQuestionSnapshot_campaignId ON CampaignQuestionSnapshot(campaignId);

-- ============================================================
-- CAMPAIGN QUESTION OPTION SNAPSHOT — frozen options
-- ============================================================
CREATE TABLE IF NOT EXISTS CampaignQuestionOptionSnapshot (
  id TEXT PRIMARY KEY,
  campaignQuestionSnapshotId TEXT NOT NULL,
  value TEXT NOT NULL,
  labelAr TEXT NOT NULL,
  score REAL,
  displayOrder INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (campaignQuestionSnapshotId) REFERENCES CampaignQuestionSnapshot(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_CQOS_snapshotId ON CampaignQuestionOptionSnapshot(campaignQuestionSnapshotId);

-- ============================================================
-- PARTICIPATION LEDGER — HMAC-based participation tracking (identity layer)
-- ============================================================
CREATE TABLE IF NOT EXISTS ParticipationLedger (
  id TEXT PRIMARY KEY,
  campaignId TEXT NOT NULL,
  executiveId TEXT,
  employeeHmac TEXT NOT NULL,
  participationType TEXT NOT NULL,
  scopeKey TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  submittedAt TEXT,
  FOREIGN KEY (campaignId) REFERENCES Campaign(id) ON DELETE CASCADE,
  UNIQUE(campaignId, employeeHmac, participationType, scopeKey)
);

CREATE INDEX IF NOT EXISTS idx_ParticipationLedger_campaignId ON ParticipationLedger(campaignId);
CREATE INDEX IF NOT EXISTS idx_ParticipationLedger_employeeHmac ON ParticipationLedger(employeeHmac);

-- ============================================================
-- RESPONSE — anonymous response storage (no employee identifiers)
-- ============================================================
CREATE TABLE IF NOT EXISTS Response (
  id TEXT PRIMARY KEY,
  campaignId TEXT NOT NULL,
  executiveId TEXT,
  responseGroupId TEXT NOT NULL,
  questionSnapshotId TEXT NOT NULL,
  selectedValue TEXT NOT NULL,
  selectedScore REAL,
  responseType TEXT NOT NULL,
  submittedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (campaignId) REFERENCES Campaign(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_Response_campaignId ON Response(campaignId);
CREATE INDEX IF NOT EXISTS idx_Response_campaignId_responseType ON Response(campaignId, responseType);
CREATE INDEX IF NOT EXISTS idx_Response_campaignId_executiveId ON Response(campaignId, executiveId);
CREATE INDEX IF NOT EXISTS idx_Response_responseGroupId ON Response(responseGroupId);

-- ============================================================
-- ADMIN USERS + AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS AdminUser (
  id TEXT PRIMARY KEY,
  externalId TEXT NOT NULL UNIQUE,
  displayName TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'SURVEY_ADMIN',
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS AuditLog (
  id TEXT PRIMARY KEY,
  adminUserId TEXT,
  action TEXT NOT NULL,
  entityType TEXT NOT NULL,
  entityId TEXT,
  campaignId TEXT,
  metadataJson TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (campaignId) REFERENCES Campaign(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_AuditLog_campaignId ON AuditLog(campaignId);
CREATE INDEX IF NOT EXISTS idx_AuditLog_entityType ON AuditLog(entityType);
CREATE INDEX IF NOT EXISTS idx_AuditLog_createdAt ON AuditLog(createdAt);

-- ============================================================
-- SYSTEM SETTINGS — key/value store for global config
-- ============================================================
CREATE TABLE IF NOT EXISTS SystemSetting (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  valueAr TEXT NOT NULL,
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
