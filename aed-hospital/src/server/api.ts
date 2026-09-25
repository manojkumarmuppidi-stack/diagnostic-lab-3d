import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { zodErrorMap } from "@/lib/schemas";
import { getActor } from "./auth";
import type { Actor } from "./authz";
import { AppError } from "./errors";

type Params = Record<string, string>;

export interface ApiContext<P extends Params = Params> {
  req: NextRequest;
  actor: Actor;
  params: P;
  url: URL;
}

interface Options {
  /** Allow users whose password must be changed (auth endpoints). */
  allowPasswordChange?: boolean;
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite cookies). */
function checkOrigin(req: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers / server-to-server tools
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "Please correct the highlighted fields", code: "VALIDATION", fields: zodErrorMap(err) }, { status: 400 });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return NextResponse.json({ error: "A record with these details already exists", code: "UNIQUE" }, { status: 409 });
    if (err.code === "P2025") return NextResponse.json({ error: "Record not found", code: "NOT_FOUND" }, { status: 404 });
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/immutable|not permitted/i.test(msg)) {
    return NextResponse.json({ error: "This change is blocked by accounting controls", code: "INTEGRITY" }, { status: 409 });
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json({ error: "Something went wrong. The error has been logged.", code: "INTERNAL" }, { status: 500 });
}

/** Wrap an authenticated API handler: origin check → session → handler → JSON/error mapping. */
export function api<P extends Params = Params>(
  handler: (ctx: ApiContext<P>) => Promise<unknown>,
  opts: Options = {},
) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      if (!checkOrigin(req)) return NextResponse.json({ error: "Cross-site request blocked", code: "CSRF" }, { status: 403 });
      const actor = await getActor();
      if (!actor) return NextResponse.json({ error: "Please sign in", code: "UNAUTHORIZED" }, { status: 401 });
      if (actor.mustChangePassword && !opts.allowPasswordChange) {
        return NextResponse.json({ error: "You must change your password first", code: "PASSWORD_CHANGE_REQUIRED" }, { status: 403 });
      }
      const params = (await context?.params) ?? ({} as P);
      const result = await handler({ req, actor, params, url: new URL(req.url) });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}
