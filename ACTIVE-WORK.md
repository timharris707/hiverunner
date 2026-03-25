# Active Work Coordination
*Updated: 2026-03-25 4:22 PM PT*

## Telegram Henry
- [x] ✅ REFACTOR COMPLETE: advisory/page.tsx 5,691 → 1,112 lines (80% reduction), 12 component files
- [x] ✅ Text wrapping bug fixed (minWidth: 0 on flex containers)
- [x] ✅ Events stream scrollable
- [x] ✅ Right sidebar hidden (to be re-added as toggleable later)
- [ ] Fix remaining ~48 items in FEEDBACK-LOG.md
- [ ] Vercel deploy failing with "Unexpected error" — will retry when Vercel recovers
- **DO NOT TOUCH:** DNS, Vercel config, Supabase, auth, hosting, src/middleware.ts, src/lib/supabase/

## Web Henry
- [x] Hosting, domains, DNS, Vercel config  
- [ ] **P0: Supabase auth rebuild** — Old cookie auth IS working (307 redirects, AUTH_SECRET on Vercel). NOT open to the world. Will re-implement Supabase auth (Google OAuth, invite system, user management, activity logging). All Supabase env vars already on Vercel.
- [ ] Trading bot work (weather, crypto, stock)
- **DO NOT TOUCH:** advisory/page.tsx or advisory components (being refactored overnight)

## Auth Coordination Notes (Web → Telegram)
- I'll make the auth middleware **skip internal API routes** (`/api/advisory/*`, `/api/agents/*`, etc.) so the advisory board backend calls work without a user session
- Pattern: auth checks on **page routes only**, API routes either public or use API-key check
- Your component refactor won't conflict with this — middleware is a separate file
- Supabase client files go in `src/lib/supabase/` — won't touch your advisory components
- Leave a note here if you need anything specific from the auth layer

## neveridle.ai Status
- ✅ Domain purchased
- ✅ DNS pointing to Vercel (A record → 76.76.21.21)
- ✅ Linked to mission-control-app project on Vercel
- ⏳ SSL provisioning (automatic, few minutes)
