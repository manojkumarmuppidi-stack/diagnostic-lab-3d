-- Read-only access keys are sessions of kind KEY (sent as a Bearer header, GET requests only).
ALTER TABLE "Session" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'BROWSER';
