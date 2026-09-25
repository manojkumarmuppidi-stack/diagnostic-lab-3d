import { api, readJson } from "@/server/api";
import { requirePermission } from "@/server/authz";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { getSettings, saveSettings, settingsSchema } from "@/server/settings";

export const GET = api(async () => getSettings());

export const PUT = api(async ({ actor, req }) => {
  requirePermission(actor, "settings.manage");
  const value = settingsSchema.parse(await readJson(req));
  return prisma.$transaction(async (tx) => {
    const before = await getSettings(tx);
    await saveSettings(tx, value, actor.id);
    await audit(tx, actor, { action: "SETTINGS_UPDATE", entityType: "Setting", entityId: "app", before, after: value });
    return value;
  });
});
