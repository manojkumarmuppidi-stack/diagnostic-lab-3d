-- Reception uploads the OneGlance pharmacy reports too: both reception roles may view, enter and
-- import Hormonal Pharmacy records (import is limited to what a role may enter by hand).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
  FROM "Role" r CROSS JOIN "Permission" p
 WHERE r."code" IN ('RECEPTION', 'RECEPTION_EXPENSES') AND p."code" IN ('pharmacy.view', 'pharmacy.write')
ON CONFLICT DO NOTHING;
