-- Reception bills lab tests at the front desk and uploads the OneGlance lab reports:
-- both reception roles may view, enter and import laboratory transactions.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
  FROM "Role" r CROSS JOIN "Permission" p
 WHERE r."code" IN ('RECEPTION', 'RECEPTION_EXPENSES') AND p."code" IN ('lab.view', 'lab.write')
ON CONFLICT DO NOTHING;
