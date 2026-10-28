import { describe, expect, it } from "vitest";
import { compileDepartments, departmentFor, DEFAULT_DEPARTMENTS } from "@/lib/departments";

const depts = compileDepartments(DEFAULT_DEPARTMENTS.map(([name, keywords], i) => ({ id: name, name, keywords, sortOrder: (i + 1) * 10 })));
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
    ["DIET", "Diet Follow up", "Diet"],
    ["OPD", "Diet consultation", "Diet"],
    ["SCP", "Sugar Control Plan", "SCP — Sugar Control Plans"],
    ["SCP", "F/u by bhagya", "SCP — Sugar Control Plans"],
    ["SCP", "Short admission by Spandana", "Short admissions"],
    ["IPD", "MMP admission", "JJ Wellness — MMP admissions"],
  ])("%s %s → %s", (stream, name, expected) => expect(dept(stream, name)).toBe(expected));

  it.each([
    ["OPD", "Thyroid Old Consultation"],
    ["OPD", "Old Thyroid+Wellness Consultation"],
    ["LAB", "HbA1c"],
    ["LAB", "X-RAY WRIST AP VIEW"],
    ["OPD", "Growth (short) Disorder"],
    ["IPD", "Other"],
  ])("%s %s is in no department", (stream, name) => expect(dept(stream, name)).toBeNull());
});
