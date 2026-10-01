-- Expense privacy: "expense.view" now means "the expenses I entered"; seeing everyone's expenses
-- (salaries, totals, month-wise) needs "expense.view_all". Every role that could see expenses
-- before keeps seeing all of them.
INSERT INTO "Permission" ("id", "code", "description", "group")
VALUES ('perm_expense_view_all', 'expense.view_all', 'See everyone''s expenses, totals, month-wise and the monthly checklist', 'Expenses')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", (SELECT "id" FROM "Permission" WHERE "code" = 'expense.view_all')
  FROM "RolePermission" rp JOIN "Permission" p ON p."id" = rp."permissionId"
 WHERE p."code" = 'expense.view'
ON CONFLICT DO NOTHING;

-- Linking an expense to its routine head is classification only (amount, date and category are
-- untouched), so it may be set after entry: imported expenses are linked to heads afterwards.
DROP TRIGGER IF EXISTS immutable_expense ON "Expense";
CREATE TRIGGER immutable_expense BEFORE UPDATE ON "Expense"
  FOR EACH ROW EXECUTE FUNCTION aed_guard_immutable('status', 'voidReason', 'updatedAt', 'approvedById', 'approvedAt', 'spreadMonth', 'headId');
