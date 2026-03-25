# Active Work Coordination
*Updated: 2026-03-25 4:15 PM PT*

## Telegram Henry (overnight)
- [ ] REFACTOR: Break advisory/page.tsx (5,700 lines) into ~10 component files
- [ ] Fix all 51 items in FEEDBACK-LOG.md
- [ ] Fix the text wrapping / layout bug (showstopper)
- **DO NOT TOUCH:** DNS, Vercel config, Supabase, auth, hosting

## Web Henry
- [x] Hosting, domains, DNS, Vercel config  
- [ ] **P0: Supabase auth rebuild** — Telegram Henry reverted the previous auth because it broke the app before Supabase was configured. NOW Supabase is ready, so auth needs to go back in. Site is currently OPEN TO THE WORLD on neveridle.ai — fix ASAP.
- [ ] Trading bot work (weather, crypto, stock)
- **DO NOT TOUCH:** advisory/page.tsx or advisory components (being refactored overnight)

## neveridle.ai Status
- ✅ Domain purchased
- ✅ DNS pointing to Vercel (A record → 76.76.21.21)
- ✅ Linked to mission-control-app project on Vercel
- ⏳ SSL provisioning (automatic, few minutes)
