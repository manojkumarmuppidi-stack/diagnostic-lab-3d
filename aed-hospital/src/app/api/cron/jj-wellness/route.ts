import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { AppError } from "@/server/errors";
import { syncJjWellness } from "@/server/services/jj-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Nightly JJ Wellness sync, called by Vercel Cron (vercel.json) with "Authorization: Bearer <CRON_SECRET>". */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await syncJjWellness(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    console.error("JJ Wellness sync failed", e);
    return NextResponse.json({ error: e instanceof AppError ? e.message : "Sync failed" }, { status });
  }
}
