import { describe, expect, it } from "vitest";
import { matchHead, type HeadRule } from "@/lib/expenses";

const H = (id: string, name: string, keywords: string, categoryId: string, subcategoryId: string | null = null, departmentId: string | null = null, sortOrder = 0): HeadRule => ({ id, name, keywords, categoryId, subcategoryId, departmentId, sortOrder });
const heads = [
  H("rc", "Rent – Cash", "rent,building rent", "rent"),
  H("ro", "Rent – Online", "rent,building rent,neft", "rent", null, null, 1),
  H("el", "Electricity bill", "electricity,current", "elec"),
  H("doc", "Doctor fees", "doctor,consultant,dr", "docs", null, null, 0),
  H("echo", "Visiting doctor – 2D Echo", "echo,2d echo", "docs", null, null, 5),
  H("sal", "Staff salaries", "salary,salaries", "sal", "support"),
  H("hp", "Hormonal Pharmacy – staff salary", "pharmacy,salary", "sal", "support", "pharmacyDept"),
  H("ox", "Oxygen cylinders", "oxygen,cylinder", "med", "cons"),
  H("mc", "Medical consumables", "gloves,syringe", "med", "cons"),
];

describe("linking an expense to its routine head", () => {
  const m = (description: string, categoryId: string, subcategoryId: string | null = null, departmentId: string | null = null) => matchHead(heads, { description, categoryId, subcategoryId, departmentId })?.id ?? null;
  it("uses the wording to tell heads of one category apart", () => {
    expect(m("Rent – Cash – Sep 2026", "rent")).toBe("rc");
    expect(m("Rent – Online – Sep 2026", "rent")).toBe("ro");
    expect(m("Dr Bhaskar (2D Echo) – Jan 2026", "docs")).toBe("echo");
    expect(m("Dr.Anurag CX Charges", "docs")).toBe("doc");
  });
  it("takes the only head of a category even without matching words", () => {
    expect(m("EB payment", "elec")).toBe("el");
  });
  it("keeps department heads to their department", () => {
    expect(m("Salary – Sep", "sal", "support")).toBe("sal");
    expect(m("Salary – Sep", "sal", "support", "pharmacyDept")).toBe("hp");
  });
  it("leaves it unlinked when nothing singles a head out", () => {
    expect(m("Toplap Gel", "med", "cons")).toBeNull();
    expect(m("Nitrous oxide cylinder", "med", "cons")).toBe("ox");
    expect(m("Anything", "nocat")).toBeNull();
  });
});
