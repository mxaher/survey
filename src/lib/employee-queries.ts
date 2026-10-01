/**
 * SQL shared by the employee executive endpoints.
 *
 * `CampaignExecutive` has no `id` column (its primary key is
 * `campaignId, executiveId`), so neither query may select `ce.id` — doing so
 * made `/api/employee/executives` and its per-executive questions sibling
 * throw `no such column: ce.id`, which is why the wizard used to show an
 * empty roster. `tests/integration/employee-queries.test.ts` runs both
 * statements against the fully migrated schema so this can't regress.
 */

export const ASSIGNED_EXECUTIVES_SQL = `
  SELECT ce.displayOrder, ce.isEnabled,
         e.id AS executiveId, e.nameAr, e.titleAr, e.category, e.departmentAr
  FROM CampaignExecutive ce
  JOIN Executive e ON e.id = ce.executiveId
  WHERE ce.campaignId = ? AND ce.isEnabled = 1 AND e.isActive = 1 AND e.deletedAt IS NULL
  ORDER BY ce.displayOrder ASC`;

export const EXECUTIVE_ASSIGNMENT_SQL = `
  SELECT ce.displayOrder, ce.isEnabled,
         e.id AS executiveId, e.nameAr, e.titleAr, e.category, e.departmentAr,
         e.isActive, e.deletedAt
  FROM CampaignExecutive ce
  JOIN Executive e ON e.id = ce.executiveId
  WHERE ce.campaignId = ? AND ce.executiveId = ?`;
