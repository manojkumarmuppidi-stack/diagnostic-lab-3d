/**
 * Seed: permissions, roles, admin user, master data and settings (idempotent).
 * With SEED_DEMO_DATA=true it also loads ~4 months of CLEARLY FICTIONAL demo data
 * (patient codes "DEMO-…", names "Demo Patient …", doctors "Dr. Demo …").
 * Never enable demo data on a production database.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_DEFS } from "../src/lib/permissions";
import { addDays, todayISO, toDbDate, fromDbDate } from "../src/lib/dates";
import { round2 } from "../src/lib/money";
import { classifyLabItem } from "../src/lib/import/lab-category";
import { fingerprintFor } from "../src/server/services/modules";
import { DEFAULT_SETTINGS } from "../src/server/settings";

const prisma = new PrismaClient();
const DEMO = process.env.SEED_DEMO_DATA === "true";

const SPECIALTIES = ["Diabetes", "Thyroid", "Obesity", "Hormones", "General"];
const DEPARTMENTS = ["OPD", "IPD", "Laboratory", "Radiology", "Cardiology", "Pharmacy", "Diet & Nutrition", "Kitchen", "Housekeeping", "Administration", "Maintenance", "Wellness"];
const CONSULT_TYPES: [string, number][] = [["Consultation", 800], ["Follow-up", 500], ["Review with Reports", 300], ["Tele-consultation", 500]];
const ADMISSION_TYPES = ["Long Admission", "Short Admission", "Sugar Control Plan", "Other"];
const PACKAGES: [string, string, number][] = [
  ["Sugar Control Plan – 5 Days", "Sugar Control Plan", 45000],
  ["Sugar Control Plan – 3 Days", "Sugar Control Plan", 30000],
  ["Short Stay – 1 Day", "Short Admission", 12000],
  ["Long Stay – 7 Days", "Long Admission", 70000],
];
// [name, category, department, demo rate]. Production seeds rate 0 — Admin must set real rates.
const INVESTIGATIONS: [string, string, string, number][] = [
  ["Fundus", "Ophthalmic", "Laboratory", 500],
  ["2D Echo", "Cardiac", "Cardiology", 1800],
  ["ECG", "Cardiac", "Cardiology", 300],
  ["Foot Examination", "Diabetic Foot", "Laboratory", 600],
  ["USG Thyroid", "Ultrasound", "Radiology", 1200],
  ["USG Fatty Liver", "Ultrasound", "Radiology", 1200],
  ["USG PVR", "Ultrasound", "Radiology", 900],
  ["Doppler Ultrasound", "Ultrasound", "Radiology", 2500],
  ["TMT", "Cardiac", "Cardiology", 2000],
  ["Diabetic Profile", "Pathology", "Laboratory", 1500],
  ["Mini Diabetic Profile", "Pathology", "Laboratory", 800],
  ["USG Abdomen & Pelvis", "Ultrasound", "Radiology", 1500],
  ["X-Ray", "Radiology", "Radiology", 500],
  ["Obesity Basic", "Pathology", "Laboratory", 2500],
  ["Obesity Plus", "Pathology", "Laboratory", 4500],
  ["CT", "Imaging", "Radiology", 4000],
  ["MRI", "Imaging", "Radiology", 7000],
];
const DIET_SERVICES: [string, number][] = [["Diet Counselling", 500], ["Weight Management Plan", 2500], ["Diabetic Diet Plan", 1500], ["Follow-up Diet Review", 300]];
const EXPENSE_CATEGORIES: [string, "HOSPITAL" | "OTHER", string[]][] = [
  ["Groceries", "HOSPITAL", ["Vegetables", "Provisions", "Milk & Dairy"]],
  ["Kitchen", "HOSPITAL", ["Gas", "Utensils"]],
  ["Toiletries", "HOSPITAL", []],
  ["Housekeeping", "HOSPITAL", ["Linen & Laundry", "Uniforms", "Bio-medical waste"]],
  ["Cleaning materials", "HOSPITAL", []],
  ["Stationery", "HOSPITAL", ["Printing", "Printer paper"]],
  ["Maintenance", "HOSPITAL", ["Electrical", "Plumbing", "AC service"]],
  ["Electricity", "HOSPITAL", []],
  ["Water", "HOSPITAL", ["Drinking water cans", "Tanker"]],
  ["Transport", "HOSPITAL", ["Fuel", "Auto / Cab"]],
  ["Administrative", "HOSPITAL", ["Internet & Phone", "Software"]],
  ["Marketing", "HOSPITAL", ["Print ads", "Digital"]],
  ["Medical supplies", "HOSPITAL", ["Consumables", "Lab reagents"]],
  // Not in the original brief, but usually the largest hospital costs — without them the net result is overstated.
  ["Salaries & Wages", "HOSPITAL", ["Doctors", "Nursing", "Support staff", "OT technicians", "Security"]],
  ["Rent", "HOSPITAL", []],
  ["Doctor & consultant fees", "HOSPITAL", []],
  ["Referral fees", "HOSPITAL", []],
  // Outside parties paid under an MOU, e.g. the wellness partner's share of wellness-patient revenue.
  ["MOU partners", "HOSPITAL", ["Revenue share"]],
  ["Outsourced lab tests", "HOSPITAL", []],
  ["Taxes & compliance", "HOSPITAL", []],
  ["Staff welfare", "OTHER", []],
  ["Equipment (capital)", "OTHER", []],
  // Refunds of patient payments found in cash books: an income reversal, kept apart so it is visible.
  ["Patient refunds", "OTHER", []],
  ["Other", "OTHER", []],
];
/**
 * Recurring monthly expense heads (the "one word" quick pick). Generic only: no amounts or
 * people's names — an Admin adds typical amounts and payees under Masters → Expense heads.
 * [name, category, subcategory, keywords, default mode (null = suggest from amount), monthly, department]
 */
const EXPENSE_HEADS: [string, string, string | null, string, string | null, boolean, string?][] = [
  ["Rent – Cash", "Rent", null, "rent,building rent", "CASH", true],
  ["Rent – Online", "Rent", null, "rent,building rent,neft", "BANK", true],
  ["Building maintenance", "Maintenance", null, "maintenance,society,building", null, true],
  ["Electricity bill", "Electricity", null, "electricity,current,power,eb", null, true],
  ["Staff salaries", "Salaries & Wages", "Support staff", "salary,salaries,wages,staff", null, true],
  ["Nursing salaries", "Salaries & Wages", "Nursing", "salary,nurse,nursing", null, true],
  ["OT technicians", "Salaries & Wages", "OT technicians", "ot,technician,ot tech,salary", null, true],
  ["Security", "Salaries & Wages", "Security", "security,watchman,guard,salary", null, true],
  ["Housekeeping staff", "Salaries & Wages", "Support staff", "housekeeping,cleaning staff,salary", null, true],
  ["Doctor fees", "Doctor & consultant fees", null, "doctor,consultant,visiting,dr", null, true],
  ["OP referral – Cash", "Referral fees", null, "referral,op referral", "CASH", true],
  ["OP referral – Online", "Referral fees", null, "referral,op referral", "BANK", true],
  ["IP referral", "Referral fees", null, "referral,ip referral", null, true],
  // Wellness programme: its two costs, both tagged to the Wellness department so they can be read against wellness income.
  ["Wellness – revenue share", "MOU partners", "Revenue share", "wellness,jj wellness,revenue share,mou,partner", null, true, "Wellness"],
  ["Wellness – staff salaries", "Salaries & Wages", "Support staff", "wellness,salary,salaries", null, true, "Wellness"],
  ["Milk", "Groceries", "Milk & Dairy", "milk,curd,dairy", "CASH", true],
  ["Newspaper", "Administrative", null, "newspaper,news", "CASH", true],
  ["Gas cylinders", "Kitchen", "Gas", "gas,cylinder,lpg", null, true],
  ["Drinking water cans", "Water", "Drinking water cans", "water,cans,bottles", null, true],
  ["Oxygen cylinders", "Medical supplies", "Consumables", "oxygen,o2,cylinder", null, true],
  ["Lab reagents", "Medical supplies", "Lab reagents", "reagent,stock,diagnostics,lab", null, true],
  ["Outsourced lab tests", "Outsourced lab tests", null, "outside,outsource,sample,lab", null, true],
  ["Tissue rolls & toiletries", "Toiletries", null, "tissue,toilet,hand wash", "CASH", true],
  ["Scan papers & stationery", "Stationery", null, "scan paper,a4,bond,printing,stationery", null, true],
  ["Phone & internet", "Administrative", "Internet & Phone", "phone,mobile,internet,wifi,recharge", null, true],
  ["TV subscription", "Administrative", "Internet & Phone", "tv,dth,tata sky", null, true],
  ["Hospital software & SMS", "Administrative", "Software", "software,sms,hms,oneglance", null, true],
  ["Digital marketing", "Marketing", "Digital", "marketing,digital,seo,ads", null, true],
  ["Online listings", "Marketing", "Digital", "practo,justdial,listing", null, false],
  ["Bio-medical waste", "Housekeeping", "Bio-medical waste", "biomedical,bio waste,waste", null, true],
  ["ESI", "Taxes & compliance", null, "esi,esic", "BANK", true],
  ["PF", "Taxes & compliance", null, "pf,epf,provident fund", "BANK", true],
  ["Professional tax", "Taxes & compliance", null, "pt,professional tax", null, true],
  ["TDS", "Taxes & compliance", null, "tds,194c,194j,192b", "BANK", true],
  ["GST", "Taxes & compliance", null, "gst", "BANK", true],
  ["Accountant fees", "Taxes & compliance", null, "accounts,accountant,ca", null, true],
  ["Audit & ROC filing", "Taxes & compliance", null, "audit,roc,filing", null, false],
  ["GHMC / trade licence", "Taxes & compliance", null, "ghmc,trade licence,property tax,license", null, false],
];
const PAYMENT_MODES: [string, string, "CASH" | "CARD" | "UPI" | "BANK" | "OTHER"][] = [
  ["CASH", "Cash", "CASH"],
  ["CARD", "Card", "CARD"],
  ["UPI", "UPI", "UPI"],
  ["BANK", "Bank Transfer", "BANK"],
  ["CHEQUE", "Cheque", "BANK"],
  ["OTHER", "Other", "OTHER"],
];

async function seedSecurity() {
  for (const code of ALL_PERMISSIONS) {
    const p = PERMISSIONS[code];
    await prisma.permission.upsert({ where: { code }, create: { code, description: p.description, group: p.group }, update: { description: p.description, group: p.group } });
  }
  const perms = await prisma.permission.findMany();
  for (const [code, def] of Object.entries(ROLE_DEFS)) {
    const existing = await prisma.role.findUnique({ where: { code } });
    const role = await prisma.role.upsert({ where: { code }, create: { code, name: def.name, description: def.description, isSystem: true }, update: { name: def.name, description: def.description } });
    // Only set permissions on first creation (Admin may have customised them since), except ADMIN which always gets everything.
    if (!existing || code === "ADMIN") {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({ data: perms.filter((p) => (def.permissions as string[]).includes(p.code)).map((p) => ({ roleId: role.id, permissionId: p.id })) });
    }
  }
  const admin = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
  if (!(await prisma.user.findUnique({ where: { username: "admin" } }))) {
    const pw = process.env.SEED_ADMIN_PASSWORD;
    if (!pw || pw.length < 8) throw new Error("No admin user yet: set SEED_ADMIN_PASSWORD (min 8 chars) for the first deploy/seed, then remove it.");
    await prisma.user.create({ data: { username: "admin", name: "Administrator", passwordHash: bcrypt.hashSync(pw, 12), roleId: admin.id, mustChangePassword: !DEMO } });
    console.log("✔ admin user created (username: admin) — you can now remove SEED_ADMIN_PASSWORD");
  }
}

async function seedMasters() {
  for (const [i, name] of SPECIALTIES.entries()) await prisma.specialty.upsert({ where: { name }, create: { name, sortOrder: i }, update: {} });
  for (const name of DEPARTMENTS) await prisma.department.upsert({ where: { name }, create: { name }, update: {} });
  for (const [name, rate] of CONSULT_TYPES) await prisma.consultationType.upsert({ where: { name }, create: { name, defaultRate: DEMO ? rate : 0 }, update: {} });
  for (const name of ADMISSION_TYPES) await prisma.admissionType.upsert({ where: { name }, create: { name }, update: {} });
  for (const [name, type, rate] of PACKAGES) {
    const t = await prisma.admissionType.findUniqueOrThrow({ where: { name: type } });
    await prisma.ipdPackage.upsert({ where: { name }, create: { name, admissionTypeId: t.id, rate: DEMO ? rate : 0 }, update: {} });
  }
  for (const [name, category, dept, rate] of INVESTIGATIONS) {
    const d = await prisma.department.findUniqueOrThrow({ where: { name: dept } });
    await prisma.labInvestigation.upsert({ where: { name }, create: { name, category, departmentId: d.id, rate: DEMO ? rate : 0 }, update: {} });
  }
  // Tests created by early imports were all categorised "Imported"; give them a real category (idempotent).
  for (const inv of await prisma.labInvestigation.findMany({ where: { category: "Imported" }, select: { id: true, name: true } })) {
    await prisma.labInvestigation.update({ where: { id: inv.id }, data: { category: classifyLabItem(inv.name).category } });
  }
  for (const [name, rate] of DIET_SERVICES) await prisma.dietService.upsert({ where: { name }, create: { name, rate: DEMO ? rate : 0 }, update: {} });
  for (const [name, group, subs] of EXPENSE_CATEGORIES) {
    let cat = await prisma.expenseCategory.findFirst({ where: { name, parentId: null } });
    if (!cat) cat = await prisma.expenseCategory.create({ data: { name, group } });
    for (const s of subs) {
      if (!(await prisma.expenseCategory.findFirst({ where: { name: s, parentId: cat.id } }))) {
        await prisma.expenseCategory.create({ data: { name: s, parentId: cat.id, group } });
      }
    }
  }
  for (const [i, [code, name, reconGroup]] of PAYMENT_MODES.entries()) {
    await prisma.paymentMode.upsert({ where: { code }, create: { code, name, reconGroup, sortOrder: i }, update: {} });
  }
  // Heads are created once; later Admin edits (amounts, payees, keywords) are never overwritten.
  // 0.8.0 briefly seeded "MOU partner payments"; it is the wellness revenue share, so rename it in place.
  const oldMou = await prisma.expenseHead.findUnique({ where: { name: "MOU partner payments" } });
  if (oldMou && !(await prisma.expenseHead.findUnique({ where: { name: "Wellness – revenue share" } }))) {
    await prisma.expenseHead.update({ where: { id: oldMou.id }, data: { name: "Wellness – revenue share" } });
  }
  for (const [i, [name, catName, subName, keywords, defaultMode, monthly, deptName]] of EXPENSE_HEADS.entries()) {
    const existing = await prisma.expenseHead.findUnique({ where: { name } });
    const cat = await prisma.expenseCategory.findFirstOrThrow({ where: { name: catName, parentId: null } });
    const sub = subName ? await prisma.expenseCategory.findFirst({ where: { name: subName, parentId: cat.id } }) : null;
    const dept = deptName ? await prisma.department.findUnique({ where: { name: deptName } }) : null;
    if (existing) {
      // Fill structure added later (subcategory, department) without overwriting Admin edits.
      if ((sub && !existing.subcategoryId && existing.categoryId === cat.id) || (dept && !existing.departmentId)) {
        await prisma.expenseHead.update({
          where: { id: existing.id },
          data: { ...(sub && !existing.subcategoryId && existing.categoryId === cat.id ? { subcategoryId: sub.id } : {}), ...(dept && !existing.departmentId ? { departmentId: dept.id, monthly } : {}) },
        });
      }
      continue;
    }
    await prisma.expenseHead.create({ data: { name, keywords, categoryId: cat.id, subcategoryId: sub?.id ?? null, departmentId: dept?.id ?? null, defaultMode, monthly, sortOrder: i * 10 } });
  }
  if (!(await prisma.setting.findUnique({ where: { key: "app" } }))) {
    await prisma.setting.create({ data: { key: "app", value: DEFAULT_SETTINGS } });
  }
}

// ─────────────────────────── demo data ───────────────────────────

let seed = 20260925;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const between = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));
function weightedMode(ids: Record<string, string>) {
  const r = rnd();
  return r < 0.38 ? ids.CASH : r < 0.78 ? ids.UPI : r < 0.93 ? ids.CARD : ids.BANK;
}

async function seedDemo() {
  if (await prisma.patient.findFirst({ where: { patientCode: { startsWith: "DEMO-" } } })) {
    console.log("• demo data already present — skipped");
    return;
  }
  console.log("… loading fictional demo data (clearly marked DEMO)");
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.code, r.id]));
  const demoUsers: [string, string, string][] = [
    ["accounts", "Demo Accounts User", "ACCOUNTS"],
    ["reception", "Demo Reception User", "RECEPTION"],
    ["ipd", "Demo IPD User", "IPD_STAFF"],
    ["lab", "Demo Lab User", "LAB_STAFF"],
    ["pharmacy", "Demo Pharmacy User", "PHARMACY"],
    ["management", "Demo Management User", "MANAGEMENT"],
  ];
  const demoHash = bcrypt.hashSync("Demo#12345", 12);
  for (const [username, name, role] of demoUsers) {
    await prisma.user.upsert({ where: { username }, create: { username, name, roleId: roles[role], passwordHash: demoHash }, update: {} });
  }
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  const by = admin.id;

  const spec = Object.fromEntries((await prisma.specialty.findMany()).map((s) => [s.name, s.id]));
  const doctorsSpec: [string, string][] = [["Dr. Demo Anand", "Diabetes"], ["Dr. Demo Bhavana", "Thyroid"], ["Dr. Demo Chandra", "Obesity"], ["Dr. Demo Deepa", "Hormones"], ["Dr. Demo Eshwar", "General"]];
  const doctors: { id: string; spec: string }[] = [];
  for (const [name, s] of doctorsSpec) {
    const d = await prisma.doctor.upsert({ where: { name_kind: { name, kind: "DOCTOR" } }, create: { name, kind: "DOCTOR", specialtyId: spec[s] }, update: {} });
    doctors.push({ id: d.id, spec: s });
  }
  const dietician = await prisma.doctor.upsert({ where: { name_kind: { name: "Demo Dietician Farah", kind: "DIETICIAN" } }, create: { name: "Demo Dietician Farah", kind: "DIETICIAN" }, update: {} });
  const ctypes = await prisma.consultationType.findMany();
  const modes = Object.fromEntries((await prisma.paymentMode.findMany()).map((m) => [m.code, m.id]));
  const invs = await prisma.labInvestigation.findMany();
  const invWeights: Record<string, number> = { "Diabetic Profile": 10, "Mini Diabetic Profile": 9, ECG: 8, Fundus: 6, "Foot Examination": 6, "USG Fatty Liver": 4, "USG Thyroid": 4, "2D Echo": 3, "X-Ray": 3, "Obesity Basic": 2, "USG Abdomen & Pelvis": 2, TMT: 2, "USG PVR": 2, "Doppler Ultrasound": 1, "Obesity Plus": 1, CT: 0.5, MRI: 0.4 };
  const invPool = invs.flatMap((i) => Array(Math.max(1, Math.round((invWeights[i.name] ?? 1) * 2))).fill(i));
  const admTypes = Object.fromEntries((await prisma.admissionType.findMany()).map((t) => [t.name, t.id]));
  const pkgs = await prisma.ipdPackage.findMany();
  const dietSvcs = await prisma.dietService.findMany();
  const cats = await prisma.expenseCategory.findMany();
  const topCats = cats.filter((c) => !c.parentId);
  const depts = Object.fromEntries((await prisma.department.findMany()).map((d) => [d.name, d.id]));

  // 300 fictional patients.
  const patients = [];
  for (let i = 1; i <= 2500; i++) patients.push({ patientCode: `DEMO-${String(1000 + i)}`, name: `Demo Patient ${String(i).padStart(3, "0")}` });
  await prisma.patient.createMany({ data: patients });
  const pRows = await prisma.patient.findMany({ where: { patientCode: { startsWith: "DEMO-" } } });
  const seenPatients = new Set<string>();

  const today = todayISO();
  const start = addDays(today, -118);
  const consultations: Prisma.ConsultationCreateManyInput[] = [];
  const labs: Prisma.LabTransactionCreateManyInput[] = [];
  const sales: Prisma.PharmacySaleCreateManyInput[] = [];
  const returns: Prisma.PharmacyReturnCreateManyInput[] = [];
  const purchases: Prisma.PharmacyPurchaseCreateManyInput[] = [];
  const diets: Prisma.DietTransactionCreateManyInput[] = [];
  const others: Prisma.OtherIncomeCreateManyInput[] = [];
  const expenses: Prisma.ExpenseCreateManyInput[] = [];
  let invoice = 1;

  for (let d = start; d < today; d = addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (d.endsWith("-05")) {
      for (const [name, amount] of [["Electricity", between(38, 52) * 1000], ["Water", between(6, 9) * 1000], ["Marketing", between(15, 30) * 1000], ["Salaries & Wages", between(1750, 1850) * 1000], ["Rent", 300000]] as const) {
        const cat = topCats.find((c) => c.name === name)!;
        expenses.push({ date: toDbDate(d), categoryId: cat.id, departmentId: depts.Administration, description: `${name} – monthly (demo)`, vendor: "Demo Utility", billNumber: `DEMO-${name}-${d}`, amount, paymentModeId: modes.BANK, fingerprint: fingerprintFor("expense", { date: d, vendor: "Demo Utility", billNumber: `DEMO-${name}-${d}`, categoryId: cat.id }, amount), createdById: by });
      }
      others.push({ date: toDbDate(d), source: "Canteen Rent (demo)", amount: 8000, paymentModeId: modes.BANK, fingerprint: fingerprintFor("other-income", { date: d, source: "Canteen Rent (demo)" }, 8000), createdById: by });
    }
    if (dow === 0) continue; // closed on Sundays
    const growth = 1 + (118 - (Date.parse(today) - Date.parse(d)) / 86_400_000) / 400; // mild growth trend
    const nOpd = Math.round(between(28, 55) * growth * (dow === 6 ? 0.7 : 1));
    for (let k = 0; k < nOpd; k++) {
      // ~30% of visits are new patients (first visit), the rest follow-ups of patients already seen.
      const seen = pRows.filter((x) => seenPatients.has(x.id));
      const wantNew = rnd() < 0.3 || seen.length < 20;
      const p = wantNew ? pRows.find((x) => !seenPatients.has(x.id)) ?? pick(pRows) : pick(seen);
      const isNew = !seenPatients.has(p.id);
      seenPatients.add(p.id);
      const doc = rnd() < 0.55 ? doctors[0] : pick(doctors);
      const ct = isNew ? ctypes.find((c) => c.name === "Consultation")! : pick(ctypes.filter((c) => c.name !== "Consultation"));
      const gross = Number(ct.defaultRate) || 500;
      const discount = rnd() < 0.08 ? round2(gross * 0.1) : 0;
      const input = { date: d, patientCode: p.patientCode, patientName: p.name, specialtyId: spec[doc.spec], reference: null };
      consultations.push({
        date: toDbDate(d), patientId: p.id, patientName: p.name, doctorId: doc.id, specialtyId: spec[doc.spec], consultationTypeId: ct.id,
        visitType: isNew ? "NEW" : "OLD", grossAmount: gross, discount, netAmount: gross - discount, paymentModeId: weightedMode(modes),
        fingerprint: fingerprintFor("opd", input, gross - discount), createdById: by,
      });
      // ~55% of OPD patients get investigations.
      if (rnd() < 0.55) {
        const nTests = between(1, 3);
        for (let t = 0; t < nTests; t++) {
          const inv = pick(invPool);
          const rate = Number(inv.rate);
          const disc = rnd() < 0.1 ? round2(rate * 0.1) : 0;
          labs.push({
            date: toDbDate(d), patientId: p.id, patientName: p.name, investigationId: inv.id, quantity: 1, rate, grossAmount: rate, discount: disc, netAmount: rate - disc,
            paymentModeId: weightedMode(modes), referringDoctorId: doc.id, departmentId: inv.departmentId,
            fingerprint: fingerprintFor("lab", { date: d, patientCode: p.patientCode, investigationId: inv.id }, rate - disc), createdById: by,
          });
        }
      }
      if (rnd() < 0.08) {
        const svc = pick(dietSvcs);
        const rate = Number(svc.rate);
        diets.push({
          date: toDbDate(d), patientId: p.id, patientName: p.name, serviceId: svc.id, dieticianId: dietician.id, grossAmount: rate, discount: 0, netAmount: rate,
          paymentModeId: weightedMode(modes), fingerprint: fingerprintFor("diet", { date: d, patientCode: p.patientCode, serviceId: svc.id }, rate), createdById: by,
        });
      }
    }
    const nSales = Math.round(between(25, 50) * growth);
    for (let k = 0; k < nSales; k++) {
      const gross = between(3, 60) * 50;
      const disc = rnd() < 0.2 ? round2(gross * 0.05) : 0;
      const inv = `PH-DEMO-${String(invoice++).padStart(5, "0")}`;
      sales.push({ date: toDbDate(d), invoiceNo: inv, patientName: rnd() < 0.7 ? pick(pRows).name : null, grossAmount: gross, discount: disc, netAmount: gross - disc, paymentModeId: weightedMode(modes), fingerprint: fingerprintFor("pharmacy-sale", { date: d, invoiceNo: inv }, gross - disc), createdById: by });
      if (rnd() < 0.02) returns.push({ date: toDbDate(d), invoiceNo: inv, amount: round2(gross * 0.3), paymentModeId: modes.CASH, reason: "Demo return", fingerprint: fingerprintFor("pharmacy-return", { date: d, invoiceNo: inv }, round2(gross * 0.3)), createdById: by });
    }
    if (dow === 1 || dow === 4) {
      const amt = between(120, 200) * 1000;
      const inv = `DPD/DEMO/${d}`;
      purchases.push({ date: toDbDate(d), supplier: pick(["Demo Pharma Distributors", "Demo Medi Agencies"]), invoiceNo: inv, amount: amt, paymentModeId: modes.BANK, fingerprint: fingerprintFor("pharmacy-purchase", { date: d, supplier: "x", invoiceNo: inv }, amt), createdById: by });
    }
    // Daily expenses.
    const nExp = between(2, 6);
    for (let k = 0; k < nExp; k++) {
      const cat = pick(topCats.filter((c) => !["Electricity", "Water", "Marketing", "Salaries & Wages", "Rent"].includes(c.name)));
      const subs = cats.filter((c) => c.parentId === cat.id);
      const sub = subs.length && rnd() < 0.6 ? pick(subs) : null;
      const amount = between(2, 60) * 100;
      const bill = `DEMO-BILL-${d}-${k}`;
      expenses.push({
        date: toDbDate(d), categoryId: cat.id, subcategoryId: sub?.id ?? null, departmentId: pick([depts.Kitchen, depts.Housekeeping, depts.Administration, depts.Maintenance, depts.OPD]),
        description: `${sub?.name ?? cat.name} (demo)`, vendor: "Demo Vendor", billNumber: bill, amount, paymentModeId: rnd() < 0.7 ? modes.CASH : modes.UPI,
        fingerprint: fingerprintFor("expense", { date: d, vendor: "Demo Vendor", billNumber: bill, categoryId: cat.id }, amount), createdById: by,
      });
    }

  }
  const chunk = async <T,>(rows: T[], fn: (c: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += 2000) await fn(rows.slice(i, i + 2000));
  };
  await chunk(consultations, (c) => prisma.consultation.createMany({ data: c }));
  await chunk(labs, (c) => prisma.labTransaction.createMany({ data: c }));
  await chunk(sales, (c) => prisma.pharmacySale.createMany({ data: c }));
  await chunk(returns, (c) => prisma.pharmacyReturn.createMany({ data: c }));
  await chunk(purchases, (c) => prisma.pharmacyPurchase.createMany({ data: c }));
  await chunk(diets, (c) => prisma.dietTransaction.createMany({ data: c }));
  await chunk(others, (c) => prisma.otherIncome.createMany({ data: c }));
  await chunk(expenses, (c) => prisma.expense.createMany({ data: c }));

  // IPD admissions (~1–2 per working day) with advances / settlements; a few left outstanding.
  let admCount = 0;
  for (let d = start; d < today; d = addDays(d, 1)) {
    const n = rnd() < 0.35 ? 0 : between(1, 2);
    for (let k = 0; k < n; k++) {
      const pkg = rnd() < 0.5 ? pkgs.find((p) => p.name.startsWith("Sugar Control Plan – 5"))! : pick(pkgs);
      const p = pick(pRows);
      const gross = Number(pkg.rate);
      const discount = rnd() < 0.25 ? 5000 : 0;
      const net = gross - discount;
      const days = pkg.name.includes("7") ? 7 : pkg.name.includes("5") ? 5 : pkg.name.includes("3") ? 3 : 1;
      const discharge = addDays(d, days);
      const adm = await prisma.ipdAdmission.create({
        data: {
          admissionDate: toDbDate(d), dischargeDate: discharge < today ? toDbDate(discharge) : null, patientId: p.id, patientName: p.name,
          admissionTypeId: pkg.admissionTypeId ?? admTypes.Other, doctorId: doctors[0].id, packageId: pkg.id, grossAmount: gross, discount, netAmount: net,
          fingerprint: fingerprintFor("ipd", { admissionDate: d, patientCode: p.patientCode, admissionTypeId: pkg.admissionTypeId }, net), createdById: by,
        },
      });
      admCount++;
      const advance = Math.min(net, 10000);
      const txs: Prisma.IpdTransactionCreateManyInput[] = [
        { admissionId: adm.id, date: toDbDate(d), type: "ADVANCE", amount: advance, paymentModeId: weightedMode(modes), fingerprint: `seed-adv-${adm.id}`, createdById: by },
      ];
      const settleDate = discharge < today ? discharge : null;
      if (settleDate && rnd() < 0.9 && net > advance) {
        txs.push({ admissionId: adm.id, date: toDbDate(settleDate), type: "FINAL_SETTLEMENT", amount: net - advance, paymentModeId: rnd() < 0.5 ? modes.CARD : modes.UPI, fingerprint: `seed-fin-${adm.id}`, createdById: by });
      }
      await prisma.ipdTransaction.createMany({ data: txs.filter((t) => fromDbDate(t.date as Date) < today) });
    }
  }

  // Close all days older than 5 days with a matching reconciliation (a realistic, controlled history).
  const closeUntil = addDays(today, -5);
  const expected = await prisma.$queryRaw<{ date: Date; grp: string; amount: Prisma.Decimal }[]>`
    SELECT v.date, COALESCE(pm."reconGroup"::text, 'OTHER') AS grp, SUM(v.amount) AS amount
      FROM v_income_line v LEFT JOIN "PaymentMode" pm ON pm.id = v.payment_mode_id
     WHERE v.date <= ${toDbDate(closeUntil)} GROUP BY 1, 2`;
  const byDate = new Map<string, Record<string, number>>();
  for (const e of expected) {
    const k = fromDbDate(e.date);
    const m = byDate.get(k) ?? { CASH: 0, CARD: 0, UPI: 0, BANK: 0, OTHER: 0 };
    m[e.grp] = Number(e.amount);
    byDate.set(k, m);
  }
  for (const [date, groups] of byDate) {
    const now = new Date();
    const day = await prisma.dailyAccount.create({
      data: { date: toDbDate(date), status: "CLOSED", reviewedById: by, reviewedAt: now, reconciledById: by, reconciledAt: now, closedById: by, closedAt: now, notes: "Demo: closed by seed" },
    });
    await prisma.reconciliation.createMany({
      data: Object.entries(groups).map(([g, amt]) => ({ dailyAccountId: day.id, reconGroup: g as "CASH", expected: amt, actual: amt, variance: 0, userId: by })),
    });
    await prisma.dayEvent.create({ data: { dailyAccountId: day.id, fromStatus: "RECONCILED", toStatus: "CLOSED", action: "CLOSE", reason: "Demo seed", userId: by } });
  }
  console.log(`✔ demo: ${consultations.length} OPD, ${labs.length} lab, ${sales.length} pharmacy sales, ${admCount} admissions, ${expenses.length} expenses, ${byDate.size} closed days`);
}

async function main() {
  await seedSecurity();
  await seedMasters();
  console.log("✔ roles, permissions, master data and settings");
  if (DEMO) await seedDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
