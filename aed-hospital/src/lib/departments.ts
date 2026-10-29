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
  pharmacyItems?: string | null;
  pharmacyIncentivePct?: number | null;
  partnerName?: string | null;
  partnerSharePct?: number | null;
}

interface Compiled {
  id: string;
  name: string;
  phrases: string[];
  streams: string[];
  addOns: string[];
  addOnAmount: number;
  /** Pharmacy medicine words whose sales margin is this department's income. */
  pharmacyPhrases: string[];
  pharmacyIncentivePct: number;
  partnerName: string;
  partnerSharePct: number;
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
        pharmacyPhrases: splitList(r.pharmacyItems).map((p) => norm(p)).filter(Boolean),
        pharmacyIncentivePct: Number(r.pharmacyIncentivePct) || 0,
        partnerName: (r.partnerName ?? "").trim(),
        partnerSharePct: Number(r.partnerSharePct) || 0,
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

/** The department whose pharmacy medicine words occur in this medicine name ("INJ MOUNJARO KWIKPEN 5MG"). */
export function pharmacyDepartmentFor(depts: Compiled[], medicine: string): Compiled | null {
  const text = ` ${norm(medicine)} `;
  return depts.find((d) => d.pharmacyPhrases.some((p) => text.includes(` ${p} `))) ?? null;
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

export const GLP_INJECTIONS =
  "mounjaro, yurpeak, yurpeck, glipiq, semanext, semanat, semalix, semasize, semafull, sematrinity, semabest, semawin, semaglu, sembolic, sunday, sundae, ozempic, wegovy, ozanta, wyntide, obeda, extensior, povizitra";

export interface DeptDefault {
  name: string;
  keywords: string;
  addOnKeywords?: string;
  addOnAmount?: number;
  pharmacyItems?: string;
  pharmacyIncentivePct?: number;
  partnerName?: string;
  partnerSharePct?: number;
}

/** AED's departments as agreed (Oct 2026); editable under Master Data → Income departments. */
export const DEFAULT_DEPARTMENTS: DeptDefault[] = [
  { name: "USG scan room", keywords: "usg, ultrasound, ultra sound, sonography, doppler, fnac, fatty liver, thyroid screening, thy screening" },
  { name: "Foot exam, neuropathy & physiotherapy", keywords: "foot, neuropathy, physio, physiotherapy" },
  { name: "Cardiac (2D Echo, TMT, ECG)", keywords: "2d echo, echo, tmt, treadmill, treadmil, ecg" },
  {
    name: "JJ Wellness",
    keywords: "skin, hair, bmi, wellness consultation, mmp",
    addOnKeywords: "consultation, wellness consultation, wellness",
    addOnAmount: 200,
    pharmacyItems: GLP_INJECTIONS,
    pharmacyIncentivePct: 1,
    partnerName: "JJ Wellness",
    partnerSharePct: 20,
  },
  { name: "Ophthalmology", keywords: "pft, ar, fundus, ophthal, ophthalmology, eye" },
  { name: "Diet", keywords: "diet, stream:DIET" },
  { name: "SCP — Sugar Control Plans", keywords: "sugar control, scp, stream:SCP" },
  { name: "Short admissions", keywords: "short admission, short admissions, short adm" },
  { name: "Long admissions", keywords: "long admission, long admissions, long adm" },
];
