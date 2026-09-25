import { z } from "zod";
import { prisma, type Tx } from "./db";

export const settingsSchema = z.object({
  hospitalName: z.string().trim().min(2).max(120),
  hospitalAddress: z.string().trim().max(300),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  alerts: z.object({
    enabled: z.boolean(),
    unclosedDaysLookback: z.number().int().min(1).max(90),
    largeExpenseAmount: z.number().min(0),
    revenueDeviationPct: z.number().min(1).max(500),
    outstandingIpdAmount: z.number().min(0),
    reconVarianceTolerance: z.number().min(0),
    missingDataLookbackDays: z.number().int().min(1).max(60),
  }),
});
export type AppSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  hospitalName: "AED Hospital",
  hospitalAddress: "KPHB, Hyderabad, Telangana",
  fiscalYearStartMonth: 4,
  alerts: {
    enabled: true,
    unclosedDaysLookback: 14,
    largeExpenseAmount: 25000,
    revenueDeviationPct: 30,
    outstandingIpdAmount: 1,
    reconVarianceTolerance: 0,
    missingDataLookbackDays: 7,
  },
};

const KEY = "app";

export async function getSettings(tx: Tx = prisma): Promise<AppSettings> {
  const row = await tx.setting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_SETTINGS;
  const merged = { ...DEFAULT_SETTINGS, ...(row.value as object), alerts: { ...DEFAULT_SETTINGS.alerts, ...((row.value as { alerts?: object }).alerts ?? {}) } };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(tx: Tx, value: AppSettings, userId: string) {
  await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedById: userId }, update: { value, updatedById: userId } });
}
