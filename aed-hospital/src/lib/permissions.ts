/**
 * Permission catalogue and default role matrix.
 * The matrix is seeded into Role/Permission/RolePermission and can be changed by
 * the Admin at runtime; the server always checks the database, never this file.
 */

export const PERMISSIONS = {
  // Dashboards & analytics
  "dashboard.view": { group: "Dashboards", description: "View executive dashboard" },
  "analytics.view": { group: "Dashboards", description: "View analytics dashboards" },
  "reports.view": { group: "Reports", description: "View reports" },
  "reports.export": { group: "Reports", description: "Export reports / data (Excel, CSV, PDF)" },
  "search.use": { group: "Dashboards", description: "Use global search" },

  // Transactions
  "opd.view": { group: "OPD", description: "View OPD consultations" },
  "opd.write": { group: "OPD", description: "Create / correct / void OPD consultations" },
  "ipd.view": { group: "IPD", description: "View IPD admissions & payments" },
  "ipd.write": { group: "IPD", description: "Create / correct / void IPD admissions & payments" },
  "lab.view": { group: "Laboratory", description: "View laboratory transactions" },
  "lab.write": { group: "Laboratory", description: "Create / correct / void laboratory transactions" },
  "pharmacy.view": { group: "Pharmacy", description: "View pharmacy sales, purchases, returns" },
  "pharmacy.write": { group: "Pharmacy", description: "Create / correct / void pharmacy records" },
  "diet.view": { group: "Diet & Nutrition", description: "View diet transactions" },
  "diet.write": { group: "Diet & Nutrition", description: "Create / correct / void diet transactions" },
  "income.view": { group: "Other Income", description: "View other income" },
  "income.write": { group: "Other Income", description: "Create / correct / void other income" },
  "expense.view": { group: "Expenses", description: "View expenses they entered themselves" },
  "expense.view_all": { group: "Expenses", description: "See everyone's expenses, totals, month-wise and the monthly checklist" },
  "expense.write": { group: "Expenses", description: "Create / correct / void expenses, attach bills" },
  "expense.approve": { group: "Expenses", description: "Approve or reject expenses entered by staff (entries by approvers count immediately)" },

  // Accounting controls
  "accounts.view": { group: "Accounting", description: "View daily accounts & reconciliation" },
  "accounts.reconcile": { group: "Accounting", description: "Review and reconcile days" },
  "accounts.close": { group: "Accounting", description: "Close days" },
  "accounts.reopen": { group: "Accounting", description: "Reopen closed days" },
  "corrections.approve": { group: "Accounting", description: "Approve / reject correction requests" },

  // Import
  "import.run": { group: "Import", description: "Upload and import Excel files — only for the modules the role can enter (expenses need approval rights)" },
  "import.override_duplicates": { group: "Import", description: "Import duplicate rows anyway" },
  "import.reverse": { group: "Import", description: "Reverse an entire import batch" },

  // Administration
  "masters.manage": { group: "Administration", description: "Manage master data and rates" },
  "users.manage": { group: "Administration", description: "Manage users, roles and permissions" },
  "audit.view": { group: "Administration", description: "View audit log" },
  "settings.manage": { group: "Administration", description: "Change settings & alert thresholds" },
  "patients.view_identity": { group: "Administration", description: "See full patient names (otherwise masked)" },
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionCode[];

const viewAllTx: PermissionCode[] = ["opd.view", "ipd.view", "lab.view", "pharmacy.view", "diet.view", "income.view", "expense.view", "expense.view_all"];

export const ROLE_DEFS: Record<string, { name: string; description: string; permissions: PermissionCode[] }> = {
  ADMIN: {
    name: "Admin / CEO",
    description: "Full access including reopening days, overrides and user management",
    permissions: ALL_PERMISSIONS,
  },
  ACCOUNTS: {
    name: "Accounts",
    description: "Income, expenses, reconciliation, closing and reports",
    permissions: [
      "dashboard.view", "analytics.view", "reports.view", "reports.export", "search.use",
      ...viewAllTx,
      "opd.write", "ipd.write", "lab.write", "pharmacy.write", "diet.write", "income.write", "expense.write",
      "accounts.view", "accounts.reconcile", "accounts.close", "corrections.approve",
      "import.run", "audit.view", "patients.view_identity",
    ],
  },
  ACCOUNTS_HEAD: {
    name: "Accounts head",
    description: "Runs the accounts: everything Accounts does, plus approving expenses entered by staff",
    permissions: [
      "dashboard.view", "analytics.view", "reports.view", "reports.export", "search.use",
      ...viewAllTx,
      "opd.write", "ipd.write", "lab.write", "pharmacy.write", "diet.write", "income.write", "expense.write", "expense.approve",
      "accounts.view", "accounts.reconcile", "accounts.close", "corrections.approve",
      "import.run", "audit.view", "patients.view_identity",
    ],
  },
  RECEPTION: {
    name: "Reception",
    description: "OPD, IPD, lab, diet and pharmacy billing, and importing their OneGlance reports",
    permissions: ["dashboard.view", "search.use", "opd.view", "opd.write", "ipd.view", "ipd.write", "lab.view", "lab.write", "pharmacy.view", "pharmacy.write", "diet.view", "diet.write", "import.run", "patients.view_identity"],
  },
  RECEPTION_EXPENSES: {
    name: "Reception + expenses",
    description: "Reception work, and entering day-to-day expenses (they wait for the accounts head's approval; staff see only their own)",
    permissions: ["dashboard.view", "search.use", "opd.view", "opd.write", "ipd.view", "ipd.write", "lab.view", "lab.write", "pharmacy.view", "pharmacy.write", "diet.view", "diet.write", "expense.view", "expense.write", "import.run", "patients.view_identity"],
  },
  IPD_STAFF: {
    name: "IPD Staff",
    description: "IPD admissions, advances, payments and settlements",
    permissions: ["dashboard.view", "search.use", "ipd.view", "ipd.write", "patients.view_identity"],
  },
  LAB_STAFF: {
    name: "Lab Staff",
    description: "Laboratory & diagnostics transactions",
    permissions: ["dashboard.view", "search.use", "lab.view", "lab.write", "patients.view_identity"],
  },
  PHARMACY: {
    name: "Pharmacy",
    description: "Pharmacy sales, purchases and returns",
    permissions: ["dashboard.view", "search.use", "pharmacy.view", "pharmacy.write", "import.run", "patients.view_identity"],
  },
  MANAGEMENT: {
    name: "Management",
    description: "Read-only dashboards, analytics and reports (patient names masked)",
    permissions: ["dashboard.view", "analytics.view", "reports.view", "reports.export", "search.use", ...viewAllTx, "accounts.view", "audit.view"],
  },
};

export function hasPermission(granted: ReadonlySet<string> | readonly string[], code: PermissionCode): boolean {
  return Array.isArray(granted) ? granted.includes(code) : (granted as ReadonlySet<string>).has(code);
}

/** Mask a patient name for users without patients.view_identity: "Ramesh Kumar" → "R***h K***r". */
export function maskName(name: string | null | undefined): string | null {
  if (!name) return name ?? null;
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? `${w[0]}*` : `${w[0]}***${w[w.length - 1]}`))
    .join(" ");
}
