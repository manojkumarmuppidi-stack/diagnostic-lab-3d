import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge gate: pages need a session cookie, otherwise redirect to /login.
 * The cookie is fully validated (DB lookup, expiry, active user, permissions)
 * on the server in every layout and API handler — this is only a fast redirect.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!req.cookies.get("aed_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|login|_next|icons|manifest.webmanifest|sw.js|favicon.ico).*)"],
};
