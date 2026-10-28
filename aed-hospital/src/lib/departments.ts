/**
 * Department-wise accounts. Every AED income line has a billed name: the consultation type (OPD/SCP),
 * the lab test, the diet service or the IPD admission type. A line belongs to the first department
 * (in sort order) with a keyword found in that name; departments that take a whole stream
 * ("stream:DIET") are checked after all keyword matches, so "Short admission by Bhagya" lands in
 * Short admissions even though every SCP bill would otherwise go to SCP.
 */
import { norm } from "./import/text";

export interface DeptRule {
  id: string;
  name: string;
  keywords: string;
  sortOrder: number;
}

interface Compiled {
  id: string;
  name: string;
  phrases: string[];
  streams: string[];
}

export function compileDepartments(rules: DeptRule[]): Compiled[] {
  return [...rules]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((r) => {
      const parts = r.keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
      return {
        id: r.id,
        name: r.name,
        phrases: parts.filter((p) => !/^stream:/i.test(p)).map((p) => norm(p)).filter(Boolean),
        streams: parts.filter((p) => /^stream:/i.test(p)).map((p) => p.slice(7).trim().toUpperCase()),
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

/** AED's departments as agreed (Oct 2026); editable under Master Data → Income departments. */
export const DEFAULT_DEPARTMENTS: [string, string][] = [
  ["USG scan room", "usg, ultrasound, ultra sound, sonography, doppler, fnac, fatty liver, thyroid screening, thy screening"],
  ["Foot exam, neuropathy & physiotherapy", "foot, neuropathy, physio, physiotherapy"],
  ["Cardiac (2D Echo, TMT, ECG)", "2d echo, echo, tmt, treadmill, treadmil, ecg"],
  ["JJ Wellness (skin, hair, BMI)", "skin, hair, bmi"],
  ["Ophthalmology", "pft, ar, fundus, ophthal, ophthalmology, eye"],
  ["Diet", "diet, stream:DIET"],
  ["SCP — Sugar Control Plans", "sugar control, scp, stream:SCP"],
  ["Short admissions", "short admission, short admissions, short adm"],
  ["JJ Wellness — MMP admissions", "mmp"],
];
