/**
 * Category / subcategory for a free-text expense line ("Stock (S.N.Diagnostics)", "Sunday Duty",
 * "Bisleri water cans" …), used when importing AED's cash book. First matching rule wins, so more
 * specific rules come first. Unknown lines go to "Other" — review them in Expenses.
 */
import { norm } from "./text";

export interface ExpenseClass {
  category: string;
  subcategory?: string;
}

const RULES: [RegExp, ExpenseClass][] = [
  [/\b(patient refund|refund|test cancel\w*|scan cancel\w*|cancelled)\b/, { category: "Patient refunds" }],
  [/\b(out ?side samples?|outside test|lalpath|lal path|agilus|pft|pt inr)\b/, { category: "Outsourced lab tests" }],
  [/\bstock\b|diagnostics|bio solutions|nexogenix|reagent/, { category: "Medical supplies", subcategory: "Lab reagents" }],
  [/\b(bio ?waste|biomedical|garbage waste)\b/, { category: "Housekeeping", subcategory: "Bio-medical waste" }],
  [/\b(vijaya pharma|pharma|nitrile|gauze|guaze|absorbent|bed sheets?|pulse ox\w*|bp apparatus|thermometer)\b/, { category: "Medical supplies", subcategory: "Consumables" }],
  [/\b(medicines?|accu ?che?c?k|strips?|lancets?|oxygen|nitrous|o2|syringes?|gloves|cotton|electrodes|gel|urinary sensor|heat blanket)\b/, { category: "Medical supplies", subcategory: "Consumables" }],
  [/\belec?t?ri\w* bills?\b|\belectricity\b|\belecticity\b|\bcurrent bill\b/, { category: "Electricity" }],
  [/\bwater bill\b/, { category: "Water", subcategory: "Tanker" }],
  [/\breferr?al\b|\bref fee\b/, { category: "Referral fees" }],
  [/\bdr\b|doctor|cx charges|consultant/, { category: "Doctor & consultant fees" }],
  // Named staff AED pays directly (per accounts): OT technicians and security.
  [/\b(anjaneyulu|balaji|ot technicians?|ot tech)\b/, { category: "Salaries & Wages", subcategory: "OT technicians" }],
  [/\b(rathnam|ratnam|security|watchman)\b/, { category: "Salaries & Wages", subcategory: "Security" }],
  [/\b(salary|salaries|sunday|sundays|duty|ot|ot charges|overtime|bonus|incentive|security|watchman|hostel fee|ot assistant)\b/, { category: "Salaries & Wages", subcategory: "Support staff" }],
  [/\b(rent)\b/, { category: "Rent" }],
  [/\b(gas|cylinders?)\b/, { category: "Kitchen", subcategory: "Gas" }],
  [/\b(water cans?|bisleri|water bottles?|drinking water)\b/, { category: "Water", subcategory: "Drinking water cans" }],
  [/\b(milk|curd)\b/, { category: "Groceries", subcategory: "Milk & Dairy" }],
  [/\b(vegetables?|fruits?)\b/, { category: "Groceries", subcategory: "Vegetables" }],
  [/\b(groceries|grocerices|provisions|d ?mart|tiffins?|snacks|food|sandwich|cake|tea|coffee|biscuits|meals?|lunch)\b/, { category: "Groceries", subcategory: "Provisions" }],
  [/\b(stationery|bond papers?|scan papers?|photo papers?|papers?|ink|inks|printer|refill\w*|stickers?|name boards?|books?|note book|pen drive|xerox|printing)\b/, { category: "Stationery" }],
  [/\b(water cups?|tea cups?|cups|tissues?|tissue rolls?|napkins|hand wash|garbage covers?|covers|toilet)\b/, { category: "Toiletries" }],
  [/\b(phenyl|harpic|cleaning|mop|broom|detergent|sanitizer|surf|washroom)\b/, { category: "Cleaning materials" }],
  [/\b(bowls?|spoons?|pan|utensils?|glasses|plates|diet items|flask)\b/, { category: "Kitchen", subcategory: "Utensils" }],
  [/\b(laptop|keyboard|key board|mouse|charger|electronic items?|computer|monitor|cctv)\b/, { category: "Administrative", subcategory: "Software" }],
  [/\b(id cards?|badges?|file rack)\b/, { category: "Stationery" }],
  [/\b(electric\w*|ac|a c|servicing|repair\w*|carpenter|plumb\w*|pipeline|pipes?|door|switch|lights?|fan|batter(y|ies)|bulb|wiring|cable|painting)\b/, { category: "Maintenance" }],
  [/\b(travel\w*|rapido|taxi|auto|cab|petrol|diesel|fuel|transport|courier|porter)\b/, { category: "Transport" }],
  [/\b(uniforms?|apron|blazer)\b/, { category: "Housekeeping", subcategory: "Uniforms" }],
  [/\b(laundry|linen)\b/, { category: "Housekeeping", subcategory: "Linen & Laundry" }],
  [/\b(ghmc|gst|epf|pf|esi|tds|roc|audit\w*|registration|license|licence|professional tax)\b/, { category: "Taxes & compliance" }],
  [/\b(internet|net|wifi|telephone|phone|mobile recharge|recharge|tata sky|cloud|software|sms|amazon)\b/, { category: "Administrative", subcategory: "Internet & Phone" }],
  [/\b(camp|advertis\w*|marketing|practo|justdial|just dial|pamphlets?|flex|banner)\b/, { category: "Marketing" }],
  [/\b(machine|equipment|adv)\b/, { category: "Equipment (capital)" }],
  [/\b(trip|christmas|festival|gift|welfare|party|flowers?|rose petals|bokeh|bouquet)\b/, { category: "Staff welfare" }],
];

export function classifyExpense(description: string): ExpenseClass {
  const s = norm(description).replace(/\bdr\s*/g, "dr ");
  for (const [re, c] of RULES) if (re.test(s)) return c;
  return { category: "Other" };
}

/** "Stock (S.N.Diagnostics)" → "S.N.Diagnostics"; "Watchman (Ratnam)" → "Ratnam". */
export function vendorFrom(description: string): string | undefined {
  const m = /\(([^)]+)\)/.exec(description);
  return m ? m[1].trim() : undefined;
}
