-- Reception records IPD admissions and payments (advances, settlements, refunds) at the front desk:
-- both reception roles may view, enter and import IPD records.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
  FROM "Role" r CROSS JOIN "Permission" p
 WHERE r."code" IN ('RECEPTION', 'RECEPTION_EXPENSES') AND p."code" IN ('ipd.view', 'ipd.write')
ON CONFLICT DO NOTHING;
