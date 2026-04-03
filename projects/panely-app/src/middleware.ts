import { updateSession } from "@/lib/supabase/middleware";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/advisory", "/profile", "/billing"];
const SIGNIN_PATH = "/auth/signin";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const { user, supabaseResponse } = await updateSession(request);

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = SIGNIN_PATH;
    if (pathname !== "/advisory") {
      url.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(url);
  }

  // Already logged in → skip login page
  if ((pathname === "/login" || pathname.startsWith("/auth/signin")) && user) {
    const next = request.nextUrl.searchParams.get("next") ?? "/advisory";
    const url = request.nextUrl.clone();
    url.pathname = next;
    url.searchParams.delete("next");
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
