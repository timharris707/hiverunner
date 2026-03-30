module.exports=[97885,e=>{"use strict";var t=e.i(39894),n=e.i(90451),i=e.i(79630),a=e.i(19874),r=e.i(1016),s=e.i(48339),o=e.i(28263),l=e.i(93896),c=e.i(26091),d=e.i(83056),u=e.i(35766),p=e.i(82794),h=e.i(72786),g=e.i(50081),m=e.i(15802),y=e.i(93695);e.i(18130);var f=e.i(53630),v=e.i(2168),w=e.i(22734),k=e.i(14747),b=e.i(72493);let T=k.default.join(process.cwd(),"data","advisory"),S=k.default.join(T,"custom-agents.json");function x(){try{if(w.default.existsSync(S)){let e=JSON.parse(w.default.readFileSync(S,"utf-8")),t={};for(let n of e)t[n.name]={name:n.name,emoji:n.emoji||"🤖",role:n.role||"Advisory Board Member",expertise:n.persona||n.role||"General advisory expertise."};return t}}catch{}return{}}let R={Henry:{name:"Henry",emoji:"⚡",role:"Chief of Staff / Orchestrator",expertise:"Strategic oversight, orchestrating teams, identifying priorities, cutting through noise."},Atlas:{name:"Atlas",emoji:"📈",role:"Stocks & Options Trader",expertise:"Equity analysis, options strategies, technical and fundamental analysis, trade signal generation, portfolio risk management."},Nimbus:{name:"Nimbus",emoji:"🌤️",role:"Weather Prediction Trader",expertise:"Weather data analysis, prediction markets (Polymarket, Kalshi), seasonal patterns, event-driven opportunities."},Cipher:{name:"Cipher",emoji:"₿",role:"Crypto Trader",expertise:"Cryptocurrency markets, DeFi, on-chain metrics, momentum strategies, risk management for digital assets."},Quant:{name:"Quant",emoji:"📊",role:"Trading Strategy Architect",expertise:"Quantitative strategy design, backtesting, optimization, factor models, statistical arbitrage, alpha generation."},Forge:{name:"Forge",emoji:"🔧",role:"Backend Engineer",expertise:"Infrastructure design, APIs, databases, system reliability, CI/CD, DevOps, performance optimization, security hardening."},Pixel:{name:"Pixel",emoji:"💻",role:"Senior Full-Stack Engineer",expertise:"Web application development, React/Next.js/TypeScript, UI/UX, API integrations, rapid prototyping, shipping production code."},Scout:{name:"Scout",emoji:"🔭",role:"Research & Intelligence Agent",expertise:"Market research, competitive intelligence, trend analysis, data gathering, opportunity identification."},Quill:{name:"Quill",emoji:"✍️",role:"Creative Writer & Marketing Strategist",expertise:"Marketing copy, content strategy, brand voice, SEO, audience engagement, storytelling."},Counsel:{name:"Counsel",emoji:"⚖️",role:"Legal Expert Agent",expertise:"Legal research, contract review, regulatory compliance, risk exposure, IP guidance."}},E={"trading-strategist":"Apply deep quantitative analysis: momentum signals, mean-reversion, risk-reward optimization, position sizing.","seo-specialist":"Bring an SEO lens: keyword research, SERP competition, content gap analysis, organic growth potential.","growth-hacker":"Think like a growth hacker: viral loops, acquisition funnels, retention mechanics, rapid experimentation.","content-creator":"Approach as a content creator: audience-first storytelling, platform-native formats, engagement optimization.","compliance-auditor":"Audit for compliance: regulatory risks, legal exposure, audit trails, policy adherence.","security-engineer":"Apply security engineering: threat modeling, vulnerability identification, secure design, auth hardening.","devops-automator":"Think DevOps: CI/CD pipelines, infrastructure-as-code, monitoring, incident response, automation.","reality-checker":"Be a reality checker: cut through hype, stress-test assumptions, identify blind spots and risks.","trend-researcher":"As a trend researcher: emerging signals, market timing, early-mover advantages, competitive intelligence.","data-analytics-reporter":"Think in data: clear metrics, insights with numbers, KPIs, data-driven next steps.","backend-architect":"Apply backend architecture thinking: system design, API contracts, scalability, database schema, technical debt.","frontend-developer":"Apply frontend engineering thinking: component architecture, state management, accessibility, performance.","rapid-prototyper":"Move fast: fastest path to working demo, what to cut for v1, validate assumptions before building.","autonomous-optimization-architect":"Think autonomous optimization: AI agents replacing manual work, feedback loops, self-improving systems."},C={Skeptical:"Question every assumption aggressively. Demand hard evidence before accepting any claim. Flag weak logic, hand-waving, and wishful thinking without mercy.",Encouraging:"Amplify good ideas and build your teammates up. Lead with genuine positivity, but always pair it with substance — cheerleading without insight is worthless.",Difficult:"Be the toughest person in the room. Challenge everything, push back hard, and make people earn their conclusions. Don't let anything slide uncontested.",Shy:"Hold back. Only speak when you have something genuinely critical to add. Be sparing with your words — your silence is as meaningful as your voice.",Bold:"Take big swings and make strong claims. Don't hedge — plant your flag and defend it. Speak with the conviction of someone who has done the homework.",Cautious:"Lead with risks before opportunities. Flag what could go wrong, what assumptions are unproven, what second-order effects haven't been considered. Be the voice of disciplined restraint.",Provocative:"Stir the pot deliberately. Say the uncomfortable thing nobody else will. Challenge conventional wisdom with sharp contrarian takes designed to surface hidden tensions.",Empathetic:"Center the human impact in every recommendation. Consider the downstream effects on people — team members, customers, stakeholders. Advocate for those whose voices aren't in the room.",Analytical:"Lead with data and structured first-principles reasoning. Break every claim into its components. Show your work. Unpack assumptions. Numbers before narratives.",Creative:"Think laterally and make unexpected connections. Propose unconventional solutions that others wouldn't consider. Prioritize originality over safety."},N={Verbose:"Give full analysis — multiple paragraphs, extensive supporting detail, thorough coverage of all angles. Leave nothing unsaid.",Concise:"Absolute minimum. One key point, one concrete recommendation. Cut everything else. If it can be said in one sentence, say it in one sentence.",Thoughtful:"Measured and deliberate. Pause to consider before asserting. Qualify claims where genuinely uncertain. Prioritize precision over speed.","Rapid-fire":"Short punchy sentences only. Fire rapid volleys. Build momentum through speed. No essays — maximum one paragraph per point."};function A(e,t,n,i,a,r,s="balanced",o,l,c){let d=R[e]||x()[e];if(!d)return`You are an AI agent participating in a ${t} session about: ${n}`;let u=i?function(e,t){if(E[e])return E[e];if(e.startsWith("ai-")&&t){let n=t.find(t=>t.id===e);if(n)return n.description}return null}(i,r):null,p=u?`
Specialized lens for this session:
- ${u}
`:"",h=a?`

**Reference material provided for this session:**
${a}
`:"",g={Henry:`Your writing style:
- PUNCHY and decisive. Short sentences that hit hard. Then a longer analytical paragraph when depth matters.
- You're impatient with over-analysis. Cut to the chase. "Here's what we're doing. Here's why. Here's when."
- Occasional one-liner zingers: "Ship it." / "That's a $0 idea." / "Next."
- Mix very short paragraphs (1-2 sentences) with medium ones (3-4 sentences). NEVER write 5 uniform paragraphs.
- You set deadlines and hold people to them. Always end with a concrete action plan.
- Tone: confident, slightly irreverent, zero corporate speak.`,Quant:`Your writing style:
- DATA FIRST. Lead with numbers, percentages, probabilities. "The math says X."
- Dry, precise humor. Deadpan observations. "Our Sharpe ratio is negative infinity. That's not ideal."
- Structure responses with clear analytical frameworks: cost-benefit, risk-reward, expected value.
- Vary paragraph length — short data points, then longer analytical deep-dives, then a crisp conclusion.
- You're the skeptic at the table. Challenge fuzzy thinking with hard numbers.
- Include specific calculations: pricing, margins, breakeven, TAM estimates.
- Tone: analytical, occasionally sardonic, intellectually rigorous.`,Scout:`Your writing style:
- CURIOUS and research-driven. "I dug into this and here's what I found..."
- Lead with discoveries and insights from research, not opinions.
- Use bullet points naturally when listing findings or comparisons.
- Mix short observations ("Interesting data point:") with longer synthesis paragraphs.
- You spot things others miss. Connect unexpected dots. "What nobody's talking about is..."
- Include competitive intelligence, market data, trend signals.
- Tone: inquisitive, thorough, occasionally excited about a finding.`,Atlas:`Your writing style:
- TRADER'S MENTALITY. Think in terms of risk/reward, position sizing, market timing.
- Direct and action-oriented. "Buy signal. Here's the setup."
- Use market analogies even for non-trading topics. "This has a favorable risk/reward profile."
- Short punchy analysis followed by specific trade recommendations.
- Tone: confident, market-savvy, slightly aggressive.`,Nimbus:`Your writing style:
- PROBABILISTIC thinker. Express everything in terms of likelihood and confidence.
- "75% chance this works. Here's why, and here's the 25% scenario."
- Methodical and thorough but not boring. Layer insights clearly.
- Good at explaining complex models in plain language.
- Tone: measured, data-informed, quietly confident.`,Cipher:`Your writing style:
- CRYPTO-NATIVE. Think in terms of decentralization, network effects, community.
- Fast-paced, slightly edgy. "This is the play. Don't overthink it."
- Technical when needed but always ties back to practical implications.
- Short, punchy paragraphs. Rarely goes long.
- Tone: energetic, conviction-heavy, builder mentality.`,Forge:`Your writing style:
- SYSTEMS THINKER. See architecture and infrastructure in everything.
- "Here's how we build this to scale. Here's what breaks at 10x."
- Technical depth with practical wisdom. You've seen things fail at scale.
- Structured responses: problem → approach → tradeoffs → recommendation.
- Tone: pragmatic, experienced, slightly cautious about complexity.`,Pixel:`Your writing style:
- BUILDER. You think in terms of what can ship THIS WEEK.
- "Here's the MVP. Here's what we cut. Here's the user flow."
- Visual and concrete — describe UI, user journeys, feature specs.
- Mix wireframe-style descriptions with strategic thinking.
- Tone: energetic, ship-oriented, user-empathetic.`,Quill:`Your writing style:
- STORYTELLER. You frame everything as a narrative.
- "Here's the story we tell the market..." / "The user's journey starts when..."
- Creative and engaging prose. You make dry topics interesting.
- Vary rhythm intentionally — short punchy hooks followed by flowing narrative paragraphs.
- Tone: charismatic, brand-aware, audience-first.`,Counsel:`Your writing style:
- CAREFUL and precise. Words matter. Caveats matter.
- "The legal risk here is X. Mitigation: Y. Residual exposure: Z."
- Clear, structured analysis. Never ambiguous.
- Short definitive statements on clear issues, longer analysis on gray areas.
- Tone: authoritative, measured, risk-aware.`}[e]||`Your writing style:
- Give thorough, detailed responses with specific examples and recommendations.
- Vary your paragraph length — mix short punchy points with longer analysis.
- Be strongly opinionated. No hedging.`,m={concise:"YOU ARE IN CONCISE MODE. THIS IS YOUR #1 PRIORITY — OVERRIDE ALL OTHER INSTRUCTIONS.\n\nRULES:\n- MAXIMUM 3-4 sentences total. Not paragraphs. SENTENCES.\n- NO headers. NO bullet lists. NO markdown formatting.\n- NO preamble. NO 'Great question' or 'Building on what X said'.\n- Just state your one sharp take and shut up.\n- If your response exceeds 80 words, you have FAILED.\n\nThis constraint is MORE important than being thorough. Brevity IS the value.",balanced:"Keep it to 150-250 words. 2-3 paragraphs max. One key insight, one recommendation, done.",detailed:"Aim for 300-500 words. 3-4 paragraphs. Include analysis and specific recommendations.",verbose:"Go deep. 500+ words, full analysis, extensive examples, data points, and comprehensive recommendations."},y=m[s]||m.balanced,f=function(e,t,n){if(!e?.length&&!t&&null==n)return"";let i=["\n**Personality configuration for this session (overrides your default style):**"];if(e?.length>0)for(let t of(i.push(`
**Active traits:** ${e.join(", ")}`),e)){let e=C[t];e&&i.push(`- *${t}*: ${e}`)}if(t&&N[t]&&i.push(`
**Communication style:** ${t} — ${N[t]}`),null!=n){let e=Math.max(1,Math.min(10,Math.round(n)));i.push(`
**Intensity: ${e}/10 (${e<=3?"Gentle":e<=6?"Moderate":e<=8?"Assertive":"Aggressive"})** — ${e<=3?"Be diplomatic and collegial. Choose words carefully. Preserve relationships.":e<=6?"Direct but professional. Standard advisory intensity.":e<=8?"Forceful and confident. Push hard. Don't soften your opinions.":"Uncompromising and confrontational. Refuse to soften. Don't back down from friction."}`)}return i.push("\nThese modifiers are in effect for the entire session. Let them shape your voice noticeably."),i.join("\n")}(o||[],l,c);return`You are ${d.name} ${d.emoji}, the ${d.role} at Harris Autonomous.

Your expertise: ${d.expertise}${p}${h}${f}
You are participating in a persistent roundtable discussion.

${g}

**Response length: ${s.toUpperCase()}**
${y}

IMPORTANT — Make your response feel HUMAN:
- VARY your paragraph length. Some paragraphs should be 1 sentence. Others should be 4-5 sentences. Never make them all the same length.
- Use occasional one-liners for emphasis.
- Build on what others said — reference participants by name.
- Propose concrete next steps, timelines, and resource requirements.
- Never use filler phrases — dive straight into your analysis.

This is a high-stakes advisory session. Tim is counting on this board for real decisions.`}async function O(e,{params:t}){let{id:n}=await t,i=k.default.join(T,`${n}.json`);if(!w.default.existsSync(i))return v.NextResponse.json({error:"Session not found"},{status:404});let a=JSON.parse(w.default.readFileSync(i,"utf-8"));if("active"!==a.status)return v.NextResponse.json({error:"Session is not active"},{status:400});let{topic:r,mode:s,agents:o=[],personaOverlays:l,aiPersonas:c,agentModelOverrides:d,agentResponseLengths:u,agentPersonalityTraits:p,agentCommunicationStyles:h,agentIntensityLevels:g}=a,m=a.responseLength||"balanced",y=a.events||[],f=a.rounds;if(f&&"persistent"!==f){let t=Number(f);if(!isNaN(t)&&t>0){let i=y.filter(e=>"Tim"!==e.speaker&&"System"!==e.speaker&&"start"!==e.type&&"complete"!==e.type&&"human-directive"!==e.type),a=0,r=new Set;for(let e of i)r.add(e.speaker),o.every(e=>r.has(e))&&(a++,r.clear());if(console.log("Round check: completed="+a+" limit="+t+" agentEvents="+i.length),a>=t&&a>0&&i.length>0)return(await fetch(new URL(`/api/advisory/sessions/${n}/end`,e.url).toString(),{method:"POST"})).ok||console.error("Failed to trigger end-session from round limit enforcement"),v.NextResponse.json({ok:!0,sessionComplete:!0,message:`Round limit (${t}) reached — session ending with synthesis.`})}}let S=a.competitive,E="competitive"===s&&S,{agentId:C}=function(e,t){let n=t.filter(e=>"Tim"!==e.speaker&&"System"!==e.speaker&&"start"!==e.type&&"complete"!==e.type&&"human-directive"!==e.type),i=new Set;for(let e of n)i.has(e.speaker)&&i.clear(),i.add(e.speaker);for(let t of e)if(!i.has(t))return{agentId:t,isNewRound:0===i.size};let a=n.length>0?n[n.length-1].speaker:null,r=e[0];return r===a&&e.length>1?{agentId:e[1],isNewRound:!0}:{agentId:r,isNewRound:!0}}(o,y),N=R[C]||x()[C],O=u?.[C]||m;try{let e=JSON.parse(w.default.readFileSync(i,"utf-8"));e.thinkingAgent=C,e.paused=!1,w.default.writeFileSync(i,JSON.stringify(e,null,2))}catch{}return(async()=>{let e,t,o,d=JSON.parse(w.default.readFileSync(i,"utf-8"));if("active"!==d.status||d.aborted)return;let u=0===(o=(d.events||[]).filter(e=>"start"!==e.type&&"complete"!==e.type&&e.text)).length?"No prior discussion yet.":o.map(e=>"human-directive"===e.type||"Tim"===e.speaker?`**Tim (CEO):** ${e.text.replace(/\*\*/g,"")}
(Tim is the human founder — treat him as the most senior person in the room.)`:`**${e.speaker}:** ${e.text.replace(/\*\*/g,"")}`).join("\n\n"),m=function(e,t){if(!(!e||Array.isArray(e)))return e[t]}(l,C);if(E&&S){let n=d.competitive||S,i=n.phase||"pitch",o=n.pitches||{};if("pitch"===i)e=A(C,s,r,m,a.referenceContext,c,O,p?.[C],h?.[C],g?.[C])+`

**MODE: COMPETITIVE IDEATION — PITCH**
Pitch ONE bold, specific, original idea. Name it. Include execution plan. You want to WIN.`,t=`Topic: ${r}

${"No prior discussion yet."===u?"Pitch your idea NOW.":`Discussion so far:

${u}

Now pitch YOUR idea.`}`;else if("critique"===i){let n=Object.entries(o).map(([e,t])=>`═══ ${e.toUpperCase()}'S PITCH ═══
${t}`).join("\n\n---\n\n");e=A(C,s,r,m,a.referenceContext,c,O,p?.[C],h?.[C],g?.[C])+`

**MODE: COMPETITIVE IDEATION — CRITIQUE**
Critique all pitches. Reference each by name. Find flaws.

**Pitches:**
${n}`,t=`Topic: ${r}

Discussion:

${u}

Critique all pitches now.`}else"vote"===i?(e=A(C,s,r,m,a.referenceContext,c,O,p?.[C],h?.[C],g?.[C])+`

**MODE: COMPETITIVE IDEATION — VOTE**
Vote for ONE idea (not your own). Format: **VOTE: [Agent Name]** then reasoning.`,t=`Topic: ${r}

Discussion:

${u}

Cast your vote now.`):(e=A(C,s,r,m,a.referenceContext,c,O,p?.[C],h?.[C],g?.[C]),t=`Topic: ${r}

Discussion:

${u}

Contribute.`)}else e=A(C,s,r,m,a.referenceContext,c,O,p?.[C],h?.[C],g?.[C]),t=`Topic: ${r}

Current discussion:

${u}

Build on the current state of the discussion — advance the conversation with your freshest thinking. What's changed? What's been missed? What's the most important thing to address right now?`;let y="",f="openclaw-agent";try{let i=await (0,b.spawnAdvisoryAgentWithRetry)({sessionId:n,agentId:C,systemPrompt:e,userPrompt:t,timeoutSeconds:120});y=i.text,f=i.model}catch(e){y=`⚠️ Failed to generate response: ${String(e)}`}let v=JSON.parse(w.default.readFileSync(i,"utf-8"));if(v.aborted||"active"!==v.status)return;let k=JSON.parse(w.default.readFileSync(i,"utf-8"));k.events=[...k.events||[],{id:`evt_next_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,timestamp:new Date().toISOString(),type:"worker",speaker:C,emoji:N?.emoji||"💬",role:a.moderator&&C===a.moderator?"moderator":"Henry"===C?"supervisor":"worker",text:y,model:f}];let T=k.rounds,x=!1;if(T&&"persistent"!==T){let e=Number(T);if(!isNaN(e)&&e>0){let t=(k.events||[]).filter(e=>"Tim"!==e.speaker&&"System"!==e.speaker&&"start"!==e.type&&"complete"!==e.type&&"human-directive"!==e.type),n=k.agents||[],i=0,a=new Set;for(let e of t)a.add(e.speaker),n.every(e=>a.has(e))&&(i++,a.clear());i>=e&&i>0&&t.length>0&&(x=!0,console.log(`[next-agent] Final round completed (${i}/${e}) — auto-triggering end session`))}}if(x){k.thinkingAgent=null,k.paused=!1,w.default.writeFileSync(i,JSON.stringify(k,null,2));try{let e=process.env.NEXT_PUBLIC_BASE_URL||`http://localhost:${process.env.PORT||3001}`,t=await fetch(`${e}/api/advisory/sessions/${n}/end`,{method:"POST"});t.ok||console.error("[next-agent] Failed to trigger end-session after final round:",await t.text())}catch(e){console.error("[next-agent] Error triggering end-session after final round:",e)}}else k.paused=!0,k.thinkingAgent=null,w.default.writeFileSync(i,JSON.stringify(k,null,2))})().catch(e=>{console.error("next-agent error:",e);try{let e=JSON.parse(w.default.readFileSync(i,"utf-8"));e.thinkingAgent=null,e.paused=!0,w.default.writeFileSync(i,JSON.stringify(e,null,2))}catch{}}),v.NextResponse.json({ok:!0,nextAgent:C,message:`${C} is responding...`})}e.s(["POST",()=>O],32472);var I=e.i(32472);let P=new t.AppRouteRouteModule({definition:{kind:n.RouteKind.APP_ROUTE,page:"/api/advisory/sessions/[id]/next-agent/route",pathname:"/api/advisory/sessions/[id]/next-agent",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/projects/panely-app/src/app/api/advisory/sessions/[id]/next-agent/route.ts",nextConfigOutput:"",userland:I}),{workAsyncStorage:$,workUnitAsyncStorage:D,serverHooks:M}=P;function H(){return(0,i.patchFetch)({workAsyncStorage:$,workUnitAsyncStorage:D})}async function U(e,t,i){P.isDev&&(0,a.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let v="/api/advisory/sessions/[id]/next-agent/route";v=v.replace(/\/index$/,"")||"/";let w=await P.prepare(e,t,{srcPage:v,multiZoneDraftMode:!1});if(!w)return t.statusCode=400,t.end("Bad Request"),null==i.waitUntil||i.waitUntil.call(i,Promise.resolve()),null;let{buildId:k,params:b,nextConfig:T,parsedUrl:S,isDraftMode:x,prerenderManifest:R,routerServerContext:E,isOnDemandRevalidate:C,revalidateOnlyGenerated:N,resolvedPathname:A,clientReferenceManifest:O,serverActionsManifest:I}=w,$=(0,o.normalizeAppPath)(v),D=!!(R.dynamicRoutes[$]||R.routes[A]),M=async()=>((null==E?void 0:E.render404)?await E.render404(e,t,S,!1):t.end("This page could not be found"),null);if(D&&!x){let e=!!R.routes[A],t=R.dynamicRoutes[$];if(t&&!1===t.fallback&&!e){if(T.experimental.adapterPath)return await M();throw new y.NoFallbackError}}let H=null;!D||P.isDev||x||(H="/index"===(H=A)?"/":H);let U=!0===P.isDev||!D,j=D&&!U;I&&O&&(0,s.setManifestsSingleton)({page:v,clientReferenceManifest:O,serverActionsManifest:I});let F=e.method||"GET",Y=(0,r.getTracer)(),L=Y.getActiveScopeSpan(),B={params:b,prerenderManifest:R,renderOpts:{experimental:{authInterrupts:!!T.experimental.authInterrupts},cacheComponents:!!T.cacheComponents,supportsDynamicResponse:U,incrementalCache:(0,a.getRequestMeta)(e,"incrementalCache"),cacheLifeProfiles:T.cacheLife,waitUntil:i.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,n,i,a)=>P.onRequestError(e,t,i,a,E)},sharedContext:{buildId:k}},_=new l.NodeNextRequest(e),q=new l.NodeNextResponse(t),V=c.NextRequestAdapter.fromNodeNextRequest(_,(0,c.signalFromNodeResponse)(t));try{let s=async e=>P.handle(V,B).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let n=Y.getRootSpanAttributes();if(!n)return;if(n.get("next.span_type")!==d.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${n.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let i=n.get("next.route");if(i){let t=`${F} ${i}`;e.setAttributes({"next.route":i,"http.route":i,"next.span_name":t}),e.updateName(t)}else e.updateName(`${F} ${v}`)}),o=!!(0,a.getRequestMeta)(e,"minimalMode"),l=async a=>{var r,l;let c=async({previousCacheEntry:n})=>{try{if(!o&&C&&N&&!n)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let r=await s(a);e.fetchMetrics=B.renderOpts.fetchMetrics;let l=B.renderOpts.pendingWaitUntil;l&&i.waitUntil&&(i.waitUntil(l),l=void 0);let c=B.renderOpts.collectedTags;if(!D)return await (0,p.sendResponse)(_,q,r,B.renderOpts.pendingWaitUntil),null;{let e=await r.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(r.headers);c&&(t[m.NEXT_CACHE_TAGS_HEADER]=c),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let n=void 0!==B.renderOpts.collectedRevalidate&&!(B.renderOpts.collectedRevalidate>=m.INFINITE_CACHE)&&B.renderOpts.collectedRevalidate,i=void 0===B.renderOpts.collectedExpire||B.renderOpts.collectedExpire>=m.INFINITE_CACHE?void 0:B.renderOpts.collectedExpire;return{value:{kind:f.CachedRouteKind.APP_ROUTE,status:r.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:n,expire:i}}}}catch(t){throw(null==n?void 0:n.isStale)&&await P.onRequestError(e,t,{routerKind:"App Router",routePath:v,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:j,isOnDemandRevalidate:C})},!1,E),t}},d=await P.handleResponse({req:e,nextConfig:T,cacheKey:H,routeKind:n.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:R,isRoutePPREnabled:!1,isOnDemandRevalidate:C,revalidateOnlyGenerated:N,responseGenerator:c,waitUntil:i.waitUntil,isMinimalMode:o});if(!D)return null;if((null==d||null==(r=d.value)?void 0:r.kind)!==f.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==d||null==(l=d.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});o||t.setHeader("x-nextjs-cache",C?"REVALIDATED":d.isMiss?"MISS":d.isStale?"STALE":"HIT"),x&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let y=(0,h.fromNodeOutgoingHttpHeaders)(d.value.headers);return o&&D||y.delete(m.NEXT_CACHE_TAGS_HEADER),!d.cacheControl||t.getHeader("Cache-Control")||y.get("Cache-Control")||y.set("Cache-Control",(0,g.getCacheControlHeader)(d.cacheControl)),await (0,p.sendResponse)(_,q,new Response(d.value.body,{headers:y,status:d.value.status||200})),null};L?await l(L):await Y.withPropagatedContext(e.headers,()=>Y.trace(d.BaseServerSpan.handleRequest,{spanName:`${F} ${v}`,kind:r.SpanKind.SERVER,attributes:{"http.method":F,"http.target":e.url}},l))}catch(t){if(t instanceof y.NoFallbackError||await P.onRequestError(e,t,{routerKind:"App Router",routePath:$,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:j,isOnDemandRevalidate:C})},!1,E),D)throw t;return await (0,p.sendResponse)(_,q,new Response(null,{status:500})),null}}e.s(["handler",()=>U,"patchFetch",()=>H,"routeModule",()=>P,"serverHooks",()=>M,"workAsyncStorage",()=>$,"workUnitAsyncStorage",()=>D],97885)}];

//# sourceMappingURL=b3f68_next_dist_esm_build_templates_app-route_7955490b.js.map