import { execSync } from "node:child_process";

/** Apply migrations to the test database once before the run (skipped for unit-only runs without a DB). */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://aed:aed_dev_pw@localhost:5432/aed_test?schema=public";
  if (process.env.SKIP_DB_SETUP === "1") return;
  try {
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  } catch (e) {
    console.warn("[tests] Could not migrate the test database — integration tests will fail.\n", String((e as { stderr?: Buffer }).stderr ?? e));
  }
}
