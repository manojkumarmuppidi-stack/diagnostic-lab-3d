/**
 * Category and department for a lab/diagnostic item, from its name. Used when an import
 * creates a new investigation, so "revenue by category" stays meaningful instead of
 * lumping every new test under "Imported".
 */
import { norm } from "./text";

export interface LabClass {
  category: string;
  department: string;
}

const RULES: [RegExp, LabClass][] = [
  // Lab assays whose names mention a sample type ("TB PCR (Biopsy)") stay in pathology.
  [/\b(pcr|culture|antigen|antibody|antibodies)\b/, { category: "Pathology", department: "Laboratory" }],
  [/\b(usg|ultra ?sound|sonography|doppler|scan|folicular|follicular)\b/, { category: "Ultrasound", department: "Radiology" }],
  [/\b(x ?ray|ct|hrct|mri|mammo\w*|dexa|bmd|bone density|opg)\b/, { category: "Imaging", department: "Radiology" }],
  [/\b(ecg|echo|2d echo|tmt|holter|abpm)\b/, { category: "Cardiac", department: "Cardiology" }],
  [/\b(neuropathy|nueropathy|foot|biothesio\w*|monofilament|abi|vpt)\b/, { category: "Diabetic Foot", department: "Laboratory" }],
  [/\b(fundus|retina\w*|eye|oct|refracto\w*|ophthal\w*)\b/, { category: "Ophthalmic", department: "Laboratory" }],
  [/\b(endoscopy|colonoscopy|pft|ctg)\b/, { category: "Procedures", department: "OP Procedures" }],
  [/\b(physio\w*|session|sessions|package|procedure|insertion|removal|biopsy|dressing|injection|infusion|fluids|iucd|nebuli\w*|suturing|excision)\b/, { category: "Procedures", department: "OP Procedures" }],
  [/\b(bmi|body composition|bca)\b/, { category: "Assessment", department: "Laboratory" }],
  [/\b(footwear|machine|glucometer|strips)\b/, { category: "Products", department: "OP Procedures" }],
];

export function classifyLabItem(name: string): LabClass {
  const s = norm(name);
  for (const [re, c] of RULES) if (re.test(s)) return c;
  return { category: "Pathology", department: "Laboratory" };
}
