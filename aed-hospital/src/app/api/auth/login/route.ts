import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { login } from "@/server/auth";
import { errorResponse } from "@/server/api";

const body = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
      return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
    }
    const { username, password } = body.parse(await req.json());
    const user = await login(username, password);
    return NextResponse.json({ ok: true, mustChangePassword: user.mustChangePassword });
  } catch (e) {
    return errorResponse(e);
  }
}
