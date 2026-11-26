import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { prisma } from "@/server/db";
import { accessKeyStatus, createAccessKey, revokeAccessKey } from "@/server/services/access-key";
import { ROLE_DEFS } from "@/lib/permissions";
import { seedFixture, type Fixture } from "../helpers/db";

let f: Fixture;
beforeEach(async () => {
  f = await seedFixture();
});

describe("read-only access key", () => {
  it("the role can only look, never change, and never sees patient names", () => {
    const p = ROLE_DEFS.READONLY.permissions as string[];
    expect(p.filter((c) => /\.(write|approve|close|reopen|reconcile|manage|run|reverse)$/.test(c) || c === "patients.view_identity")).toEqual([]);
    expect(p).toEqual(expect.arrayContaining(["accounts.view", "expense.view_all", "reports.export"]));
  });

  it("makes one key at a time, as a KEY session of a separate login, and switches it off", async () => {
    const a = await createAccessKey(f.admin);
    const b = await createAccessKey(f.admin);
    expect(a.key).not.toBe(b.key);
    const sessions = await prisma.session.findMany({ where: { kind: "KEY" }, include: { user: { include: { role: true } } } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(createHash("sha256").update(b.key).digest("hex"));
    expect(sessions[0].user).toMatchObject({ username: "readonly-key", active: true, mustChangePassword: false });
    expect(sessions[0].user.role.code).toBe("READONLY");
    expect(await accessKeyStatus(f.admin)).toMatchObject({ active: true });
    await revokeAccessKey(f.admin);
    expect(await prisma.session.count({ where: { kind: "KEY" } })).toBe(0);
    expect(await accessKeyStatus(f.admin)).toEqual({ active: false });
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "ACCESS_KEY" } } })).toBe(3);
  });

  it("only an Admin can make a key", async () => {
    await expect(createAccessKey(f.accounts)).rejects.toThrow(/users.manage/);
  });
});
