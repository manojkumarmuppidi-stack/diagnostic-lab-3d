-- People who bring income to a department can be found on their bills by name, so the income they
-- generated is added up automatically each month.
ALTER TABLE "DepartmentContributor" ADD COLUMN "matchText" TEXT;
