import { describe, expect, it } from "vitest";
import { addOnSplit, compileDepartments, departmentFor, DEFAULT_DEPARTMENTS } from "@/lib/departments";

const depts = compileDepartments(DEFAULT_DEPARTMENTS.map(([name, keywords, addOnKeywords, addOnAmount], i) => ({ id: name, name, keywords, addOnKeywords, addOnAmount, sortOrder: (i + 1) * 10 })));
const dept = (stream: string, name: string) => departmentFor(depts, stream, name)?.name ?? null;

describe("department of a billed item (names as billed in OneGlance)", () => {
  it.each([
    ["LAB", "USG Thyroid Doppler Scan", "USG scan room"],
    ["LAB", "Usg Thyroid Screening", "USG scan room"],
    ["LAB", "Usg  Fatty Liver ", "USG scan room"],
    ["LAB", "Usg Abdomen & Pelvis", "USG scan room"],
    ["LAB", "FNAC Thyroid", "USG scan room"],
    ["LAB", "Peripheral Neuropathy Examination", "Foot exam, neuropathy & physiotherapy"],
    ["LAB", "Foot Examination", "Foot exam, neuropathy & physiotherapy"],
    ["OPD", "Physio Consultation", "Foot exam, neuropathy & physiotherapy"],
    ["LAB", "2D Echo", "Cardiac (2D Echo, TMT, ECG)"],
    ["LAB", "TMT ( TREADMIL TEST )", "Cardiac (2D Echo, TMT, ECG)"],
    ["LAB", "ECG", "Cardiac (2D Echo, TMT, ECG)"],
    ["OPD", "Skin Consultation", "JJ Wellness (skin, hair, BMI)"],
    ["OPD", "Hair Consultation", "JJ Wellness (skin, hair, BMI)"],
    ["LAB", "BMI ANALYSIS", "JJ Wellness (skin, hair, BMI)"],
    ["LAB", "PFT", "Ophthalmology"],
    ["LAB", "AR", "Ophthalmology"],
    ["LAB", "Diabetic Fundus", "Ophthalmology"],
    ["LAB", "Thyroid Fundus", "Ophthalmology"],
    ["OPD", "Ophthalmology Consultation", "Ophthalmology"],
    ["OPD", "Wellness Consultation", "JJ Wellness (skin, hair, BMI)"],
    ["DIET", "Diet Follow up", "Diet"],
    ["OPD", "Diet consultation", "Diet"],
    ["SCP", "Sugar Control Plan", "SCP — Sugar Control Plans"],
    ["SCP", "F/u by bhagya", "SCP — Sugar Control Plans"],
    ["SCP", "Short admission by Spandana", "Short admissions"],
    ["IPD", "MMP admission", "JJ Wellness — MMP admissions"],
    ["OTHER", "JJ Wellness MMP package", "JJ Wellness — MMP admissions"],
  ])("%s %s → %s", (stream, name, expected) => expect(dept(stream, name)).toBe(expected));

  it.each([
    ["OPD", "Thyroid Old Consultation"],
    ["LAB", "HbA1c"],
    ["LAB", "X-RAY WRIST AP VIEW"],
    ["OPD", "Growth (short) Disorder"],
    ["IPD", "Other"],
  ])("%s %s is in no department", (stream, name) => expect(dept(stream, name)).toBeNull());
});

describe("combined bills: consultation + ₹200 wellness", () => {
  it.each([
    ["New Thyroid + Wellness Consultation", "New Thyroid"],
    ["Old Thyroid+Wellness Consultation", "Old Thyroid"],
    ["Old Thyroid & Diabetes+ Consultation", "Old Thyroid & Diabetes"],
    ["New Diabetes +  Consultation", "New Diabetes"],
    ["Old General +Consultation", "Old General"],
    ["New Hormonal + Wellness Consultation", "New Hormonal"],
    ["+Wellness Consultation", ""],
  ])("%s → JJ Wellness ₹200, rest is %s", (name, base) => {
    const s = addOnSplit(depts, name);
    expect(s?.dept.name).toBe("JJ Wellness (skin, hair, BMI)");
    expect(s?.dept.addOnAmount).toBe(200);
    expect(s?.base).toBe(base);
  });
  it.each(["Physio Consultation", "Gynec Consultation New", "TSH + T3", "Wellness Consultation"])("%s is not a combined bill", (name) => expect(addOnSplit(depts, name)).toBeNull());
});

describe("JJ Wellness register dates", () => {
  it("flips every Excel date back to day-first when the register is typed day-first", async () => {
    const { dayFirstDates } = await import("@/lib/import/hms");
    expect(dayFirstDates(["2026-10-09", "14-09-2026", "2026-01-10", "", "25-10-2026"])).toEqual({ dates: ["2026-09-10", "2026-09-14", "2026-10-01", "", "2026-10-25"], swapped: 2 });
  });
  it("leaves genuine Excel dates alone", async () => {
    const { dayFirstDates } = await import("@/lib/import/hms");
    expect(dayFirstDates(["2026-09-10", "2026-09-14", "2026-09-20"]).dates).toEqual(["2026-09-10", "2026-09-14", "2026-09-20"]);
  });
});
