/**
 * Department-wise accounts. Every AED income line has a billed name: the consultation type (OPD/SCP),
 * the lab test, the diet service or the IPD admission type. A line belongs to the first department
 * (in sort order) with a keyword found in that name; departments that take a whole stream
 * ("stream:DIET") are checked after all keyword matches, so "Short admission by Bhagya" lands in
 * Short admissions even though every SCP bill would otherwise go to SCP.
 *
 * Combined bills: OneGlance bills a consultation plus a fixed add-on as one item, e.g.
 * "New Thyroid + Wellness Consultation" (₹1,000 + ₹200) or, since Oct 2026, "New Thyroid + Consultation".
 * A department with add-on keywords takes its fixed amount per bill from such items (matched on the
 * part after the last "+"); the rest of the bill is placed by the part before the "+".
 */
import { norm } from "./import/text";

export interface DeptRule {
  id: string;
  name: string;
  keywords: string;
  sortOrder: number;
  addOnKeywords?: string | null;
  addOnAmount?: number | null;
}

interface Compiled {
  id: string;
  name: string;
  phrases: string[];
  streams: string[];
  addOns: string[];
  addOnAmount: number;
}

const splitList = (s: string | null | undefined) => (s ?? "").split(/[,\n]/).map((k) => k.trim()).filter(Boolean);

export function compileDepartments(rules: DeptRule[]): Compiled[] {
  return [...rules]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((r) => {
      const parts = splitList(r.keywords);
      return {
        id: r.id,
        name: r.name,
        phrases: parts.filter((p) => !/^stream:/i.test(p)).map((p) => norm(p)).filter(Boolean),
        streams: parts.filter((p) => /^stream:/i.test(p)).map((p) => p.slice(7).trim().toUpperCase()),
        addOns: Number(r.addOnAmount) > 0 ? splitList(r.addOnKeywords).map((p) => norm(p)).filter(Boolean) : [],
        addOnAmount: Number(r.addOnAmount) || 0,
      };
    });
}

/** The department an item belongs to, or null when no department claims it. */
export function departmentFor(depts: Compiled[], stream: string, itemName: string | null | undefined): Compiled | null {
  const text = ` ${norm(itemName ?? "")} `;
  for (const d of depts) if (d.phrases.some((p) => text.includes(` ${p} `))) return d;
  for (const d of depts) if (d.streams.includes(stream)) return d;
  return null;
}

/**
 * A combined bill "<base> + <add-on>": the department whose add-on keywords equal the part after the
 * last "+", and the base name left for the rest of the bill ("" when the bill is the add-on alone).
 */
export function addOnSplit(depts: Compiled[], itemName: string | null | undefined): { dept: Compiled; base: string } | null {
  const name = itemName ?? "";
  const at = name.lastIndexOf("+");
  if (at < 0) return null;
  const tail = norm(name.slice(at + 1));
  const dept = depts.find((d) => d.addOns.includes(tail));
  return dept ? { dept, base: name.slice(0, at).trim() } : null;
}

/** AED's departments as agreed (Oct 2026); editable under Master Data → Income departments. */
export const DEFAULT_DEPARTMENTS: [string, string, string?, number?][] = [
  ["USG scan room", "usg, ultrasound, ultra sound, sonography, doppler, fnac, fatty liver, thyroid screening, thy screening"],
  ["Foot exam, neuropathy & physiotherapy", "foot, neuropathy, physio, physiotherapy"],
  ["Cardiac (2D Echo, TMT, ECG)", "2d echo, echo, tmt, treadmill, treadmil, ecg"],
  ["JJ Wellness (skin, hair, BMI)", "skin, hair, bmi, wellness consultation", "consultation, wellness consultation, wellness", 200],
  ["Ophthalmology", "pft, ar, fundus, ophthal, ophthalmology, eye"],
  ["Diet", "diet, stream:DIET"],
  ["SCP — Sugar Control Plans", "sugar control, scp, stream:SCP"],
  ["Short admissions", "short admission, short admissions, short adm"],
  ["JJ Wellness — MMP admissions", "mmp"],
];
