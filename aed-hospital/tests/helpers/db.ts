/**
 * Integration-test fixtures: truncate every table (TRUNCATE bypasses the row-level
 * delete guards by design) and create the minimum roles, users and masters.
 */
import { prisma } from "@/server/db";
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_DEFS } from "@/lib/permissions";
import type { Actor } from "@/server/authz";

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export interface Fixture {
  admin: Actor;
  accounts: Actor;
  reception: Actor;
  management: Actor;
  ids: Record<string, string>;
}

async function actorFor(username: string, roleCode: string): Promise<Actor> {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode }, include: { permissions: { include: { permission: true } } } });
  const user = await prisma.user.create({ data: { username, name: username, passwordHash: "x", roleId: role.id } });
  return { id: user.id, username, name: username, roleCode, roleName: role.name, permissions: new Set(role.permissions.map((p) => p.permission.code)), mustChangePassword: false };
}

export async function seedFixture(): Promise<Fixture> {
  await resetDb();
  for (const code of ALL_PERMISSIONS) await prisma.permission.create({ data: { code, description: PERMISSIONS[code].description, group: PERMISSIONS[code].group } });
  const perms = await prisma.permission.findMany();
  for (const [code, def] of Object.entries(ROLE_DEFS)) {
    const r = await prisma.role.create({ data: { code, name: def.name, isSystem: true } });
    await prisma.rolePermission.createMany({ data: perms.filter((p) => (def.permissions as string[]).includes(p.code)).map((p) => ({ roleId: r.id, permissionId: p.id })) });
  }
  const ids: Record<string, string> = {};
  const add = (k: string, id: string) => (ids[k] = id);
  add("diabetes", (await prisma.specialty.create({ data: { name: "Diabetes" } })).id);
  add("general", (await prisma.specialty.create({ data: { name: "General" } })).id);
  add("drA", (await prisma.doctor.create({ data: { name: "Dr. Test A", specialtyId: ids.diabetes } })).id);
  add("consult", (await prisma.consultationType.create({ data: { name: "Consultation", defaultRate: 800 } })).id);
  add("lab", (await prisma.department.create({ data: { name: "Laboratory" } })).id);
  add("ecg", (await prisma.labInvestigation.create({ data: { name: "ECG", category: "Cardiac", rate: 300, departmentId: ids.lab } })).id);
  add("diabProfile", (await prisma.labInvestigation.create({ data: { name: "Diabetic Profile", category: "Pathology", rate: 1500, departmentId: ids.lab } })).id);
  add("scp", (await prisma.admissionType.create({ data: { name: "Sugar Control Plan" } })).id);
  add("otherAdm", (await prisma.admissionType.create({ data: { name: "Other" } })).id);
  add("dietSvc", (await prisma.dietService.create({ data: { name: "Diet Counselling", rate: 500 } })).id);
  add("groceries", (await prisma.expenseCategory.create({ data: { name: "Groceries", group: "HOSPITAL" } })).id);
  add("veg", (await prisma.expenseCategory.create({ data: { name: "Vegetables", group: "HOSPITAL", parentId: ids.groceries } })).id);
  add("otherExp", (await prisma.expenseCategory.create({ data: { name: "Other", group: "OTHER" } })).id);
  add("CASH", (await prisma.paymentMode.create({ data: { code: "CASH", name: "Cash", reconGroup: "CASH" } })).id);
  add("UPI", (await prisma.paymentMode.create({ data: { code: "UPI", name: "UPI", reconGroup: "UPI" } })).id);
  add("CARD", (await prisma.paymentMode.create({ data: { code: "CARD", name: "Card", reconGroup: "CARD" } })).id);
  add("BANK", (await prisma.paymentMode.create({ data: { code: "BANK", name: "Bank Transfer", reconGroup: "BANK" } })).id);
  add("OTHER", (await prisma.paymentMode.create({ data: { code: "OTHER", name: "Other", reconGroup: "OTHER" } })).id);
  return {
    admin: await actorFor("t_admin", "ADMIN"),
    accounts: await actorFor("t_accounts", "ACCOUNTS"),
    reception: await actorFor("t_reception", "RECEPTION"),
    management: await actorFor("t_mgmt", "MANAGEMENT"),
    ids,
  };
}
