import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ROLE_DEFS, maskName } from "@/lib/permissions";
import { DAY_TRANSITIONS, nextStatus } from "@/server/closing";

describe("role matrix", () => {
  const has = (role: string, p: string) => (ROLE_DEFS[role].permissions as string[]).includes(p);
  it("admin has everything", () => expect(ROLE_DEFS.ADMIN.permissions).toEqual(ALL_PERMISSIONS));
  it("management is read-only", () => {
    expect(ROLE_DEFS.MANAGEMENT.permissions.filter((p) => /\.(write|close|reopen|reconcile|approve|run|manage|reverse|override)/.test(p))).toEqual([]);
    expect(has("MANAGEMENT", "patients.view_identity")).toBe(false);
  });
  it("front-desk roles only touch their module", () => {
    expect(has("RECEPTION", "opd.write")).toBe(true);
    expect(has("RECEPTION", "expense.view")).toBe(false);
    expect(has("LAB_STAFF", "opd.view")).toBe(false);
    expect(has("PHARMACY", "pharmacy.write")).toBe(true);
    expect(has("IPD_STAFF", "ipd.write")).toBe(true);
  });
  it("only admin can reopen, override duplicates or reverse imports", () => {
    for (const r of Object.keys(ROLE_DEFS).filter((r) => r !== "ADMIN")) {
      expect(has(r, "accounts.reopen")).toBe(false);
      expect(has(r, "import.override_duplicates")).toBe(false);
      expect(has(r, "import.reverse")).toBe(false);
    }
  });
  it("masks patient names", () => {
    expect(maskName("Ramesh Kumar")).toBe("R***h K***r");
    expect(maskName(null)).toBeNull();
  });
});

describe("daily closing state machine", () => {
  it("allows only the documented transitions", () => {
    expect(nextStatus("review", "OPEN")).toBe("REVIEW");
    expect(nextStatus("reconcile", "REVIEW")).toBe("RECONCILED");
    expect(nextStatus("close", "RECONCILED")).toBe("CLOSED");
    expect(nextStatus("reopen", "CLOSED")).toBe("OPEN");
    expect(() => nextStatus("close", "OPEN")).toThrow();
    expect(() => nextStatus("close", "REVIEW")).toThrow();
    expect(() => nextStatus("review", "CLOSED")).toThrow();
    expect(Object.keys(DAY_TRANSITIONS)).toEqual(["review", "reconcile", "close", "reopen"]);
  });
});
