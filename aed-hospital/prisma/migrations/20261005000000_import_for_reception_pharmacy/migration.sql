-- Reception and pharmacy staff upload their own OneGlance/Excel reports. Import is now limited to
-- the modules a role may enter by hand (enforced in the app), so granting it is safe:
-- Reception → OPD and Diet; Pharmacy → pharmacy sales, returns, purchases and items.
-- Expenses still need approval rights to import.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
  FROM "Role" r CROSS JOIN "Permission" p
 WHERE r."code" IN ('RECEPTION', 'RECEPTION_EXPENSES', 'PHARMACY') AND p."code" = 'import.run'
ON CONFLICT DO NOTHING;
