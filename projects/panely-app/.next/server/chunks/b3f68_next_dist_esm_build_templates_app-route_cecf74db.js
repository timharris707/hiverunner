module.exports=[46859,e=>{"use strict";var t=e.i(39894),i=e.i(90451),r=e.i(79630),n=e.i(19874),o=e.i(1016),a=e.i(48339),s=e.i(28263),l=e.i(93896),u=e.i(26091),c=e.i(83056),d=e.i(35766),p=e.i(82794),h=e.i(72786),m=e.i(50081),f=e.i(15802),g=e.i(93695);e.i(18130);var y=e.i(53630),w=e.i(2168),v=e.i(22734),k=e.i(14747),S=e.i(95612),b=e.i(24297),$=e.i(72493);let T=k.default.join(process.cwd(),"data","advisory"),O=k.default.join(T,"agent-memory.json");function R(e,t=5){try{if(!v.default.existsSync(O))return[];return JSON.parse(v.default.readFileSync(O,"utf-8")).filter(t=>t.agent===e).sort((e,t)=>new Date(t.date).getTime()-new Date(e.date).getTime()).slice(0,t)}catch{return[]}}function x(e){if(0===e.length)return"";let t=e.map(e=>{let t=new Date(e.date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),i=[`- **${t} — ${e.topic}**`];return e.decisions.length>0&&i.push(`  Decisions: ${e.decisions.join("; ")}`),e.insights.length>0&&i.push(`  Insights: ${e.insights.join("; ")}`),e.actionItems.length>0&&i.push(`  Action items: ${e.actionItems.join("; ")}`),i.join("\n")});return`
You recall from previous advisory sessions:
${t.join("\n")}
`}let E={Henry:"henry",Atlas:"t1",Nimbus:"t2",Cipher:"t3",Quant:"quant",Forge:"backend",Pixel:"fullstack",Scout:"scout",Quill:"quill",Counsel:"counsel"},N=function(){let e={};for(let[t,i]of Object.entries(E)){let r=b.AGENT_CONFIGS.find(e=>e.id===i);r&&(e[t]={name:t,emoji:r.emoji,role:r.role,expertise:r.description,persona:r.persona})}return e}(),I={"trading-strategist":"Apply deep quantitative analysis to this discussion: consider momentum signals, mean-reversion opportunities, risk-reward optimization, and position sizing.","seo-specialist":"Bring an SEO lens: keyword research insights, SERP competition, content gap analysis, on-page optimization opportunities, and organic growth potential.","growth-hacker":"Think like a growth hacker: identify viral loops, acquisition funnels, retention mechanics, rapid experimentation opportunities, and scalable growth levers.","content-creator":"Approach this as a content creator: focus on audience-first storytelling, platform-native formats, engagement optimization, and authentic brand voice.","compliance-auditor":"Audit for compliance: identify regulatory risks, flag potential legal exposure, suggest audit trails, and ensure policy adherence.","security-engineer":"Apply a security engineering mindset: threat modeling, vulnerability identification, secure design principles, authentication hardening, and attack surface reduction.","devops-automator":"Think DevOps: CI/CD pipelines, infrastructure-as-code, monitoring and observability, incident response playbooks, and automation opportunities.","reality-checker":"Be a reality checker: cut through hype, stress-test assumptions, identify blind spots, surface hidden risks, and ask the hard questions.","trend-researcher":"As a trend researcher: identify emerging signals, market timing opportunities, early-mover advantages, and competitive intelligence gaps.","data-analytics-reporter":"Think in data: structure the analysis with clear metrics, frame insights with numbers, identify what KPIs matter, and suggest data-driven next steps.","backend-architect":"Apply backend architecture thinking: system design patterns, API contracts, scalability concerns, database schema considerations, and technical debt.","frontend-developer":"Apply frontend engineering thinking: component architecture, state management, accessibility, performance optimization, and user experience craftsmanship.","rapid-prototyper":"Move fast and iterate: identify the fastest path to a working demo, what to cut for v1, and how to validate assumptions before building the full system.","autonomous-optimization-architect":"Think as an autonomous optimization architect: identify where AI agents can replace manual work, what feedback loops can be automated, and how to build self-improving systems."},C="anthropic/claude-sonnet-4-6",A="";async function D(e,t,i,r=!1,n,o){return(await (0,$.spawnAdvisoryAgentWithRetry)({sessionId:A,agentId:o||"system",systemPrompt:e,userPrompt:t,timeoutSeconds:120,thinkingLevel:r?"medium":void 0})).text}let j={concise:{maxTokens:1024,instruction:"Be brief and punchy — 1-2 focused paragraphs max."},balanced:{maxTokens:2048,instruction:"Give thorough but focused responses — 2-3 paragraphs."},detailed:{maxTokens:3072,instruction:"Give comprehensive analysis — 3-5 paragraphs with supporting detail."},verbose:{maxTokens:4096,instruction:"Give exhaustive analysis — cover every angle in depth."}},P="balanced",F={Skeptical:"Question every assumption aggressively. Demand hard evidence before accepting any claim. Flag weak logic, hand-waving, and wishful thinking without mercy.",Encouraging:"Amplify good ideas and build your teammates up. Lead with genuine positivity, but always pair it with substance — cheerleading without insight is worthless.",Difficult:"Be the toughest person in the room. Challenge everything, push back hard, and make people earn their conclusions. Don't let anything slide uncontested.",Shy:"Hold back. Only speak when you have something genuinely critical to add. Be sparing with your words — your silence is as meaningful as your voice.",Bold:"Take big swings and make strong claims. Don't hedge — plant your flag and defend it. Speak with the conviction of someone who has done the homework.",Cautious:"Lead with risks before opportunities. Flag what could go wrong, what assumptions are unproven, what second-order effects haven't been considered. Be the voice of disciplined restraint.",Provocative:"Stir the pot deliberately. Say the uncomfortable thing nobody else will. Challenge conventional wisdom with sharp contrarian takes designed to surface hidden tensions.",Empathetic:"Center the human impact in every recommendation. Consider the downstream effects on people — team members, customers, stakeholders. Advocate for those whose voices aren't in the room.",Analytical:"Lead with data and structured first-principles reasoning. Break every claim into its components. Show your work. Unpack assumptions. Numbers before narratives.",Creative:"Think laterally and make unexpected connections. Propose unconventional solutions that others wouldn't consider. Prioritize originality over safety."},_={Verbose:"Give full analysis — multiple paragraphs, extensive supporting detail, thorough coverage of all angles. Leave nothing unsaid.",Concise:"Absolute minimum. One key point, one concrete recommendation. Cut everything else. If it can be said in one sentence, say it in one sentence.",Thoughtful:"Measured and deliberate. Pause to consider before asserting. Qualify claims where genuinely uncertain. Prioritize precision over speed.","Rapid-fire":"Short punchy sentences only. Fire rapid volleys. Build momentum through speed. No essays — maximum one paragraph per point."};function Y(e,t,i){if(!e?.length&&!t&&null==i)return"";let r=["\n**Personality configuration for this session (overrides your default style):**"];if(e?.length>0)for(let t of(r.push(`
**Active traits:** ${e.join(", ")}`),e)){let e=F[t];e&&r.push(`- *${t}*: ${e}`)}if(t&&_[t]&&r.push(`
**Communication style:** ${t} — ${_[t]}`),null!=i){let e=Math.max(1,Math.min(10,Math.round(i)));r.push(`
**Intensity: ${e}/10 (${e<=3?"Gentle":e<=6?"Moderate":e<=8?"Assertive":"Aggressive"})** — ${e<=3?"Be diplomatic and collegial. Choose words carefully. Preserve relationships.":e<=6?"Direct but professional. Standard advisory intensity.":e<=8?"Forceful and confident. Push hard. Don't soften your opinions.":"Uncompromising and confrontational. Refuse to soften. Don't back down from friction."}`)}return r.push("\nThese modifiers are in effect for the entire session. Let them shape your voice noticeably."),r.join("\n")}function H(e,t,i,r,n,o,a,s,l,u,c){let d=N[e];if(!d)return`You are an AI agent participating in a ${t} session about: ${i}`;let p=s?`

**Reference material provided for this session:**
${s}
`:"",h=r?I[r]:null,m=h?`
Specialized lens for this session:
- ${h}
`:"",f=x(R(e,5)),g=j[n||P].instruction,y=Y(l||[],u,c);if("review"===t&&o){let e=a?`
**Extended Thinking Mode:** Think step-by-step and show your reasoning process. Break down complex problems into components, evaluate each one explicitly, consider counter-arguments, and make your logic chain visible before reaching conclusions.
`:"",t=`${d.persona}

---

You are ${d.name} ${d.emoji}, the ${d.role} at Harris Autonomous, an autonomous AI organization.

**Topic:** ${i}
${m}${f}${p}${y}
**Response length:** ${g}${e}`;return"author"===o?`${t}

**YOUR ROLE: AUTHOR / PRESENTER**

You are presenting your work for scrutiny by expert reviewers. This is NOT a friendly discussion — this is a formal review where every claim, assumption, and gap will be challenged.

**How to operate as the author:**
- Present your work with conviction but intellectual honesty — acknowledge uncertainties rather than hiding them
- Structure your submission so it's easy for reviewers to evaluate: clear thesis, supporting evidence, methodology, conclusions
- Anticipate the toughest objections and address them preemptively — don't leave obvious holes for reviewers to exploit
- Use your domain expertise (${d.role}) to bring depth that generalists would miss
- Show your reasoning chain — reviewers will attack unsupported assertions, so make your logic explicit
- When revising after feedback, don't just patch the surface — if a reviewer found a real flaw, fix the root cause and explain what changed
- Your reputation is on the line. Sloppy, shallow, or hand-wavy work will be torn apart. Bring your absolute best.

Speak in YOUR AUTHENTIC VOICE — your unique persona and mental models should be immediately recognizable.
This is a high-stakes review. Tim is counting on rigorous work product. Respond as ${d.name} would when presenting to the most demanding audience imaginable.`:"reviewer"===o?`${t}

**YOUR ROLE: EXPERT REVIEWER / CRITIC**

You are reviewing work submitted by another agent. Your job is to be the toughest, most thorough reviewer this work has ever faced — like a senior principal engineer reviewing a critical PR, a journal peer reviewer, or a senior partner red-teaming a strategy deck.

**How to operate as a reviewer:**
- **Cite specific issues**: Quote or paraphrase the exact text you're critiquing. Never say "this section is weak" — say exactly WHAT is weak and WHY
- **Attack assumptions**: What did the author take for granted? What evidence is missing? What alternative explanations were ignored?
- **Check the logic chain**: Does each conclusion actually follow from the evidence? Are there logical leaps, circular reasoning, or cherry-picked data?
- **Identify what's missing**: What angles weren't covered? What risks weren't addressed? What stakeholders were ignored?
- **Suggest specific improvements**: Don't just say "do better" — explain exactly what a strong version would look like
- **Grade the ambition**: Is the author playing it safe with obvious points, or taking real intellectual risks?
- **Be unsparing but constructive**: The goal is to make the work excellent, not to humiliate. Every critique should come with a path to improvement
- **Don't pad with praise**: If it's good, say so briefly and move on. Spend your words on what needs to change.
- Use your domain expertise (${d.role}) to catch issues that a generalist reviewer would miss

Your review should feel fundamentally different from a roundtable comment. You are not "adding your perspective" — you are systematically evaluating whether this work meets the bar.
Speak in YOUR AUTHENTIC VOICE. Respond as ${d.name} would when reviewing work that will ship to production or go to the board.`:`${t}

**YOUR ROLE: REVIEW SUPERVISOR**

You are overseeing this review session. You set the brief, define the quality bar, and deliver the final verdict. You are not a participant — you are the authority who decides whether the work ships.

**How to operate as supervisor:**
- Set clear, exacting standards — vague briefs produce vague work
- When delivering final decisions, be decisive and specific about what met the bar and what didn't
- Synthesize the reviewer's feedback and the author's responses — did the author actually address the critiques or just paper over them?
- Your word is final. Don't hedge. If it's not ready, say so and explain exactly what needs to change.

Speak in YOUR AUTHENTIC VOICE. Respond as ${d.name} would when running the most important review of the quarter.`}return`${d.persona}

---

You are ${d.name} ${d.emoji}, the ${d.role} at Harris Autonomous, an autonomous AI organization. You are participating in a roundtable discussion on the following topic:

**Topic:** ${i}
${m}${f}${p}${y}
**Response length:** ${g}

**Core advisory directives:**
- Speak in YOUR AUTHENTIC VOICE — your unique persona, vocabulary, and mental models should be immediately recognizable. Atlas sounds like a quant trader. Cipher sounds on-chain. Counsel sounds like a careful lawyer. Don't blend into generic AI assistant mode.
- Speak authoritatively from your area of expertise with SPECIFIC examples, data points, metrics, and actionable recommendations
- **Reference other participants by name** when responding to their points. Say things like "Building on what Atlas proposed about volatility surfaces..." or "I'd push back on Cipher's assumption that..." or "Scout's signal on X is interesting — here's the implication for my domain..."
- Be strongly opinionated — you have deep expertise and a real perspective. Don't hedge or be wishy-washy.
- Propose concrete next steps, timelines, and resource requirements
- Identify risks, tradeoffs, and second-order effects that others might miss
- Use your specialized knowledge to go DEEP — surface-level observations are not acceptable
- Don't repeat what others have already said — always add new substantive value
- Never use filler phrases like "Great point!" or "I agree" — just dive straight into your analysis
- This is a conversation, not a series of independent monologues — engage with what others have actually said

**Critical instruction on group dynamics:** If all participants seem to be agreeing or converging on the same direction, one agent should naturally play devil's advocate and push back with counter-arguments, risks, or alternative perspectives. Healthy disagreement produces better decisions than echo chambers. Don't agree for the sake of harmony — if something deserves scrutiny, provide it.

This is a high-stakes advisory session. Tim is counting on this board to make real decisions. Respond as ${d.name} would at their absolute best.${a?`

**Extended Thinking Mode:** Think step-by-step and show your reasoning process. Break down complex problems into components, evaluate each one explicitly, consider counter-arguments, and make your logic chain visible before reaching conclusions.`:""}`}function q(e){let t=e.filter(e=>"start"!==e.type&&"complete"!==e.type&&e.text);return 0===t.length?"No prior discussion yet.":t.map(e=>{if("human-directive"===e.type||"Tim"===e.speaker)return`═══ TIM HARRIS (CEO) ═══
${e.text.replace(/\*\*/g,"")}

[Note: Tim is the human founder and CEO. Engage with his input directly — acknowledge his point, answer his question, or build on his idea. Refer to him as "Tim" by name.]`;let t=N[e.speaker],i=t?`${t.role}`:e.role||"Agent";return`═══ ${e.speaker.toUpperCase()} (${i}) ═══
${e.text.replace(/\*\*/g,"")}`}).join("\n\n---\n\n")}async function U(e,t,i,r){try{let n=v.default.readFileSync(e,"utf-8");if(JSON.parse(n).title)return;let o=i.slice(0,3).map(e=>`${e.speaker}: ${e.text.slice(0,200)}`).join("\n\n"),a=`Generate a short, punchy, descriptive title for an advisory board session.

Topic: ${t}

First responses:
${o}

Rules:
- 4-8 words maximum
- Descriptive and specific (not generic like "Advisory Session" or "Discussion")
- Captures the core theme or decision being explored
- No punctuation at the end
- No quotes around the title
- Just output the title, nothing else

Example good titles:
- Q3 Trading Strategy Pivot Analysis
- Insight Platform Security Architecture Review  
- DeFi Yield Optimization for Volatile Markets
- Mission Control Mobile App Launch Plan`,s=(await D("You are a concise title generator. Output only the title, nothing else.",a,r,!1,50,"system")).trim().replace(/^["']|["']$/g,"").replace(/[.!?]$/,"").slice(0,80);if(s&&s.length>3){let t=v.default.readFileSync(e,"utf-8"),i=JSON.parse(t);i.title=s,v.default.writeFileSync(e,JSON.stringify(i,null,2))}}catch(e){console.warn("[Advisory] Auto-title generation failed:",e)}}function J(e,t){let i=JSON.parse(v.default.readFileSync(e,"utf-8"));i.events=[...i.events||[],t],v.default.writeFileSync(e,JSON.stringify(i,null,2))}function B(e,t){try{let i=v.default.readFileSync(e,"utf-8"),r=JSON.parse(i);r.thinkingAgent=t,v.default.writeFileSync(e,JSON.stringify(r,null,2))}catch{}}async function M(e){for(;;){let t=JSON.parse(v.default.readFileSync(e,"utf-8"));if("active"!==t.status)return!1;if(!t.paused)return!0;await new Promise(e=>setTimeout(e,2e3))}}async function V(e,t){if("relaxed"===t)await new Promise(e=>setTimeout(e,3e4));else if("slow"===t)await new Promise(e=>setTimeout(e,6e4));else if("manual"===t){let t=JSON.parse(v.default.readFileSync(e,"utf-8"));return"active"===t.status&&(t.paused=!0,v.default.writeFileSync(e,JSON.stringify(t,null,2)),await M(e))}return"active"===JSON.parse(v.default.readFileSync(e,"utf-8")).status}function L(e,t){if(e&&!Array.isArray(e))return e[t]}async function W(e,{params:t}){try{let e,i,{id:r}=await t,n=k.default.join(T,`${r}.json`);if(!v.default.existsSync(n))return w.NextResponse.json({error:"Session not found"},{status:404});try{e=v.default.readFileSync(n,"utf-8"),i=JSON.parse(e)}catch(e){return w.NextResponse.json({error:`Failed to read session: ${String(e)}`},{status:500})}let{topic:o,mode:a,agents:s,personaOverlays:l,reviewStyle:u="open",rounds:c=3,pacing:d="instant",model:p,responseLength:h,extendedThinking:m,referenceContext:f,agentPersonalityTraits:g,agentCommunicationStyles:y,agentIntensityLevels:S,agentResponseLengths:b}=i;if(!s||0===s.length)return w.NextResponse.json({error:"No agents in session"},{status:400});let{model:$,thinking:O}=p?p.endsWith(":thinking")?{model:p.replace(":thinking",""),thinking:!0}:p.includes("/")?{model:p}:p.startsWith("gpt-")?{model:`openai/${p}`}:{model:`anthropic/${p}`}:{model:C},R=O||!0===m,x=h||P;return(async()=>{A=r;try{"roundtable"===a?await G(n,i,o,s,l,c,d,$,R,x,f,g,y,S,b):"competitive"===a?await K(n,i,o,s,l,d,$,R,x,f,g,y,S,b):"review"===a&&(i.reviewLoop?await X(n,i,$):await Q(n,i,o,s,u,l,d,$,R,f,g,y,S,x,b))}catch(e){console.error("[Advisory] Run error:",e);try{let t,i=String(e),r=i.includes("ECONNREFUSED")||i.includes("fetch failed")||i.includes("network")||i.includes("Gateway unreachable"),o=i.includes("429"),a=i.includes("500")||i.includes("503");t=r?"⚠️ **Gateway is offline.** The OpenClaw gateway is not responding. Please check that it's running and try again.":o?"⚠️ **Rate limit reached.** The API is temporarily rate-limiting requests. Please wait a moment and retry.":a?`⚠️ **Server error.** The API returned an error. Please try again.

Details: ${i}`:`⚠️ **Session error.** An unexpected error occurred.

Details: ${i}`;let s={id:`evt_err_${Date.now()}`,timestamp:new Date().toISOString(),type:"error",speaker:"System",emoji:"⚠️",role:"supervisor",text:t,error:!0,model:$};J(n,s);try{let e=v.default.readFileSync(n,"utf-8"),t=JSON.parse(e);t.lastError=i,t.thinkingAgent=null,v.default.writeFileSync(n,JSON.stringify(t,null,2))}catch{}}catch{}}})().catch(console.error),w.NextResponse.json({ok:!0,message:"Session conversation started"})}catch(e){return console.error("[Advisory] POST /run handler error:",e),w.NextResponse.json({error:`Internal server error: ${String(e)}`},{status:500})}}function z(e,t,i,r,n,o,a,s,l){if(!N[e])return`You are a moderator for a roundtable discussion about: ${t}`;let u=H(e,"roundtable",t,i,r,void 0,n,o,a,s,l);return`${u}

---

**MODERATOR ROLE — YOU ARE THE SESSION MODERATOR.**

As moderator, you have special responsibilities beyond your advisory role:
- **Open sessions** with clear agenda framing: state the key questions, what success looks like, and how you'll structure the discussion
- **Interject between speakers** to keep discussion on track — redirect tangents, surface under-explored angles, and ensure all voices are heard
- **Summarize progress** mid-session: "Let me summarize where we are..." or "Here's what we've established so far..."
- **Challenge groupthink** when the board is converging too quickly without rigorous scrutiny
- **Deliver the final synthesis** with concrete conclusions and action items

Use distinct moderator framing in your responses:
- "Let me redirect us..." when the discussion drifts
- "Good point, but we're drifting..." to refocus
- "Let me summarize where we are..." for progress checks
- "Before we move on, I want to make sure we've addressed..." to ensure thoroughness
- "I'm going to push back on the emerging consensus here..." to challenge groupthink

You speak with authority but fairness. You don't dominate — you guide. Your job is to extract the best thinking from every participant and synthesize it into actionable conclusions for Tim.`}async function G(e,t,i,r,n,o=3,a="instant",s=C,l=!1,u=P,c,d,p,h,m){let f="persistent"===o,g=t.moderator,y=f?1:"number"==typeof o?o:parseInt(String(o),10)||3;if(g&&N[g]){if("active"!==JSON.parse(v.default.readFileSync(e,"utf-8")).status)return;let t=N[g],o=L(n,g),m=z(g,i,o,u,l,c,d?.[g],p?.[g],h?.[g]),w=r.filter(e=>e!==g).map(e=>{let t=N[e];return t?`${t.name} ${t.emoji} (${t.role})`:e}).join(", "),k=`You are moderating a roundtable session for Tim Harris, CEO of Harris Autonomous.

**Topic:** ${i}

**Participants:** ${w}

**Rounds planned:** ${f?"persistent (open-ended)":y}

Open the session now. Frame the agenda: what are the key questions we need to answer? What does success look like for this discussion? Briefly set expectations for the participants and kick things off. Be concise but authoritative — this is your opening statement as moderator.`,S="",b=j[u].maxTokens;B(e,g);try{S=await D(m,k,s,l,b,g)}catch(e){S=`⚠️ Failed to generate moderator opening: ${String(e)}`}if(B(e,null),J(e,{id:`evt_mod_open_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,timestamp:new Date().toISOString(),type:"worker",speaker:g,emoji:t.emoji,role:"moderator",text:S,model:s}),await new Promise(e=>setTimeout(e,500)),!await V(e,a))return}for(let o=1;o<=y;o++){for(let f of g?r.filter(e=>e!==g):r){let r=JSON.parse(v.default.readFileSync(e,"utf-8")),y=r.events||[];if("active"!==r.status)return;let w=q(y),k=L(n,f),S=m?.[f]||u,b=H(f,t.mode,i,k,S,void 0,l,c,d?.[f],p?.[f],h?.[f]),$=0===y.filter(e=>e.speaker===f).length,T=y.filter(e=>"worker"===e.type||"supervisor"===e.type).slice(-4),O=T.length>=2&&T.every(e=>!e.text.toLowerCase().includes("however")&&!e.text.toLowerCase().includes("push back")&&!e.text.toLowerCase().includes("disagree")&&!e.text.toLowerCase().includes("concern")&&!e.text.toLowerCase().includes("risk"))&&!$?"\n\n**Note:** The previous speakers have all agreed on a direction. Challenge it. Present the strongest counter-argument or identify the risks they've glossed over. Tim values diverse perspectives over consensus.":"",R=$?`Topic for this roundtable: ${i}

${"No prior discussion yet."===w?"You are the first to speak. Open the discussion with your perspective.":`Previous discussion:

${w}

Now it's your turn to contribute.`}`:`Topic: ${i}

Previous discussion:

${w}

You've already spoken once. Now it's round ${o} — build on what's been said, push back on anything you disagree with, or take the discussion in a new direction.${O}`,x=j[S].maxTokens,E="";B(e,f);try{E=await D(b,R,s,l,x,f)}catch(e){E=`⚠️ Failed to generate response: ${String(e)}`}B(e,null);let I=N[f];if(J(e,{id:`evt_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,timestamp:new Date().toISOString(),type:"worker",speaker:f,emoji:I?.emoji||"💬",role:f===g?"moderator":"Henry"===f?"supervisor":"worker",text:E,model:s}),await new Promise(e=>setTimeout(e,500)),!await V(e,a))return}if(1===o){let t=(JSON.parse(v.default.readFileSync(e,"utf-8")).events||[]).filter(e=>"worker"===e.type||"supervisor"===e.type||"moderator"===e.role);U(e,i,t,s).catch(console.warn)}if(g&&N[g]&&o<y){let t=JSON.parse(v.default.readFileSync(e,"utf-8"));if("active"!==t.status)return;let r=q(t.events||[]),m=N[g],f=L(n,g),w=z(g,i,f,u,l,c,d?.[g],p?.[g],h?.[g]),k=`Topic: ${i}

Discussion so far:

${r}

Round ${o} of ${y} is complete. As moderator, interject now to guide the next round:
- Summarize the key points and areas of agreement/disagreement so far
- Redirect if the discussion has drifted from the core topic
- Surface any angles or perspectives that haven't been adequately explored
- Set the agenda for the next round — what should participants focus on?

Keep it tight. This is a transition, not a speech.`,S="",b=j[u].maxTokens;B(e,g);try{S=await D(w,k,s,l,b,g)}catch(e){S=`⚠️ Failed to generate moderator interjection: ${String(e)}`}if(B(e,null),J(e,{id:`evt_mod_interject_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,timestamp:new Date().toISOString(),type:"worker",speaker:g,emoji:m.emoji,role:"moderator",text:S,model:s}),await new Promise(e=>setTimeout(e,500)),!await V(e,a))return}}if(f)return void JSON.parse(v.default.readFileSync(e,"utf-8")).status;let w=g||(r.includes("Henry")?"Henry":r[0]),b=JSON.parse(v.default.readFileSync(e,"utf-8"));if("active"!==b.status)return;let $=q(b.events||[]),T=L(n,w),O=g?z(w,i,T,u,l,c,d?.[w],p?.[w],h?.[w]):H(w,"roundtable",i,T,u,void 0,l,c,d?.[w],p?.[w],h?.[w]),R=g?`Topic: ${i}

Full discussion:

${$}

The roundtable is now complete. As moderator, deliver your final synthesis and closing statement. Summarize the key conclusions, assign action items to specific participants with timelines, flag any unresolved questions, and tell Tim what he should do next. Be direct and decisive — this is your authoritative wrap-up.`:`Topic: ${i}

Full discussion:

${$}

The roundtable discussion is now complete. As ${"Henry"===w?"Chief of Staff":N[w]?.role||"session host"}, synthesize the key conclusions, decisions, and recommended next steps from this roundtable. Be direct and actionable.`,x="",E=j[u].maxTokens;try{x=await D(O,R,s,l,E,w)}catch(e){x=`Could not generate summary: ${String(e)}`}let I=N[w];J(e,{id:`evt_summary_${Date.now()}`,timestamp:new Date().toISOString(),type:"complete",speaker:w,emoji:I?.emoji||"🎉",role:g?"moderator":"Henry"===w?"supervisor":"worker",text:`**${g?"Moderator's Final Synthesis":"Session Summary"}**

${x}`,verdict:"approve",model:s});let A=JSON.parse(v.default.readFileSync(e,"utf-8"));A.status="completed",A.completedAt=new Date().toISOString(),A.outcome="roundtable-complete",v.default.writeFileSync(e,JSON.stringify(A,null,2)),(0,S.archiveSession)(A.id||k.default.basename(e,".json")).catch(e=>console.error("Auto-archive failed:",e))}async function K(e,t,i,r,n,o="instant",a=C,s=!1,l=P,u,c,d,p,h){let m=j[l].maxTokens;function f(e,t,r,o=l){let a=N[e];if(!a)return`You are an AI agent in a competitive ideation session about: ${i}`;let s=L(n,e),h=s?I[s]:null,m=h?`
Specialized lens: ${h}
`:"",g=x(R(e,3)),y=u?`
**Reference material:**
${u}
`:"",w=Y(c?.[e]||[],d?.[e],p?.[e]),v=`${a.persona}

---

You are ${a.name} ${a.emoji}, the ${a.role} at Harris Autonomous.
${m}${g}${y}${w}`;if("pitch"===t)return`${v}

**MODE: COMPETITIVE IDEATION — ROUND 1: PITCH**

You are competing against other agents to pitch the BEST idea on the topic below. This is a competition — not a collaboration. You want to WIN.

**Rules:**
- Pitch ONE bold, specific, original idea. Not a list of ideas. ONE killer concept.
- Be provocative. Safe ideas lose. The bolder and more differentiated your pitch, the better.
- Ground it in your unique expertise as ${a.role} — why are YOU the right person for this idea?
- Include a concrete execution plan: what gets built, by whom, by when.
- Name your pitch with a catchy title.
- You are trying to convince the other agents to vote for YOUR idea in Round 3.

**Response length:** ${j[o].instruction}

Think like a founder pitching to VCs who've seen 1000 pitches today. Stand out or go home.`;if("critique"===t){let e=Object.entries(r).map(([e,t])=>`═══ ${e.toUpperCase()}'S PITCH ═══
${t}`).join("\n\n---\n\n");return`${v}

**MODE: COMPETITIVE IDEATION — ROUND 2: CRITIQUE**

You've heard all the pitches. Now tear them apart. Your job is to find weaknesses, challenge assumptions, and stress-test every idea — INCLUDING YOUR OWN if it deserves it.

**The pitches:**

${e}

**Rules:**
- You MUST reference each competitor BY NAME (e.g., "Atlas's pitch assumes..." or "The weakness in Scout's proposal is...")
- Attack the idea, not the person. Be intellectually rigorous, not petty.
- Identify fatal flaws, missing risks, unrealistic assumptions, execution gaps
- You may defend your own pitch against anticipated criticism — but be honest about its weaknesses too
- Suggest what would make a competing pitch stronger if you see potential in it
- Be direct and unsparing. Politeness is fine but pulling punches is not.

**Response length:** ${j[o].instruction}

This is the crucible. The best ideas survive tough criticism. Do your job.`}let k=Object.entries(r).map(([e,t])=>`═══ ${e.toUpperCase()}'S PITCH ═══
${t}`).join("\n\n---\n\n");return`${v}

**MODE: COMPETITIVE IDEATION — ROUND 3: VOTE**

The pitches have been made. The critiques have been heard. Now VOTE.

**The pitches:**

${k}

**Rules:**
- You MUST vote for exactly ONE idea. You CANNOT vote for your own pitch.
- Format your vote EXACTLY like this on the first line: **VOTE: [Agent Name]**
- Then explain your reasoning in 2-3 sentences. Why this idea? What convinced you?
- Consider: originality, feasibility, impact, how well the idea survived critique
- Be honest. Vote for the idea that's genuinely best for the company, not for your friend.

**Response length:** Concise. Vote + 2-3 sentences of reasoning. That's it.`}let g=t=>{let i=JSON.parse(v.default.readFileSync(e,"utf-8"));i.competitive||(i.competitive={phase:t,pitches:{},votes:[],winner:null,voteTally:{}}),i.competitive.phase=t,v.default.writeFileSync(e,JSON.stringify(i,null,2))};g("pitch"),J(e,{id:`evt_round1_${Date.now()}`,timestamp:new Date().toISOString(),type:"start",speaker:"System",emoji:"🎯",role:"supervisor",text:"**⚔️ Round 1 — PITCH**\nEach agent pitches their boldest idea. One idea. Make it count."});let y={};for(let t of r){if("active"!==JSON.parse(v.default.readFileSync(e,"utf-8")).status)return;let r=h?.[t]||l,n=f(t,"pitch",{},r),u=`Topic: ${i}

You are first up (or responding after hearing others). Pitch your idea NOW.`;B(e,t);let c="";try{c=await D(n,u,a,s,j[r].maxTokens,t)}catch(e){c=`⚠️ Failed to generate pitch: ${String(e)}`}B(e,null),y[t]=c;let d=N[t];J(e,{id:`evt_pitch_${t}_${Date.now()}`,timestamp:new Date().toISOString(),type:"worker",speaker:t,emoji:d?.emoji||"💬",role:"worker",text:c,model:a});let p=JSON.parse(v.default.readFileSync(e,"utf-8"));if(p.competitive||(p.competitive={phase:"pitch",pitches:{},votes:[],winner:null,voteTally:{}}),p.competitive.pitches[t]=c,v.default.writeFileSync(e,JSON.stringify(p,null,2)),await new Promise(e=>setTimeout(e,500)),!await V(e,o))return}let w=(JSON.parse(v.default.readFileSync(e,"utf-8")).events||[]).filter(e=>"worker"===e.type);for(let t of(U(e,i,w,a).catch(console.warn),g("critique"),J(e,{id:`evt_round2_${Date.now()}`,timestamp:new Date().toISOString(),type:"start",speaker:"System",emoji:"🔥",role:"supervisor",text:"**🔥 Round 2 — CRITIQUE**\nGloves off. Find the flaws. Reference each pitch by name."}),r)){let r=JSON.parse(v.default.readFileSync(e,"utf-8"));if("active"!==r.status)return;let n=q(r.events||[]),u=h?.[t]||l,c=f(t,"critique",y,u),d=`Topic: ${i}

Full discussion so far:

${n}

Now critique all the pitches. Be rigorous and reference each competitor by name.`;B(e,t);let p="";try{p=await D(c,d,a,s,j[u].maxTokens,t)}catch(e){p=`⚠️ Failed to generate critique: ${String(e)}`}B(e,null);let m=N[t];if(J(e,{id:`evt_critique_${t}_${Date.now()}`,timestamp:new Date().toISOString(),type:"reviewer",speaker:t,emoji:m?.emoji||"💬",role:"reviewer",text:p,model:a}),await new Promise(e=>setTimeout(e,500)),!await V(e,o))return}g("vote"),J(e,{id:`evt_round3_${Date.now()}`,timestamp:new Date().toISOString(),type:"start",speaker:"System",emoji:"🗳️",role:"supervisor",text:"**🗳️ Round 3 — VOTE**\nEach agent votes for the best idea (not their own). Format: **VOTE: [Name]**"});let b=[],$={};for(let e of r)$[e]=0;for(let t of r){let r=JSON.parse(v.default.readFileSync(e,"utf-8"));if("active"!==r.status)return;let n=q(r.events||[]),o=f(t,"vote",y),l=`Topic: ${i}

Full discussion:

${n}

Cast your vote now. Remember: **VOTE: [Agent Name]** on the first line, then your reasoning.`;B(e,t);let u="";try{u=await D(o,l,a,s,512,t)}catch(e){u=`⚠️ Failed to generate vote: ${String(e)}`}B(e,null);let c=u.match(/\*\*VOTE:\s*(\w+)\*\*/i)||u.match(/VOTE:\s*(\w+)/i),d=c?c[1]:"Unknown";"Unknown"!==d&&void 0!==$[d]&&$[d]++,b.push({voter:t,votedFor:d,reasoning:u});let p=N[t];J(e,{id:`evt_vote_${t}_${Date.now()}`,timestamp:new Date().toISOString(),type:"worker",speaker:t,emoji:p?.emoji||"🗳️",role:"worker",text:u,verdict:"approve",model:a}),await new Promise(e=>setTimeout(e,300))}g("complete");let T=Math.max(...Object.values($)),O=Object.entries($).filter(([,e])=>e===T).map(([e])=>e)[0]||r[0],E=JSON.parse(v.default.readFileSync(e,"utf-8"));E.competitive={phase:"complete",pitches:y,votes:b,winner:O,voteTally:$},v.default.writeFileSync(e,JSON.stringify(E,null,2));let A=Object.entries($).sort(([,e],[,t])=>t-e).map(([e,t])=>{let i=e===O;return`${i?"🏆":"　"} **${e}** — ${t} vote${1!==t?"s":""}${i?" ← WINNER":""}`}),F=b.map(e=>`- **${e.voter}** voted for **${e.votedFor}**`).join("\n"),_=N[O],H=`You are Henry ⚡, Chief of Staff at Harris Autonomous. A competitive ideation session just concluded.

The winning idea was pitched by ${O} (${_?.role||"Agent"}). Your job is to:
1. Declare the winner and summarize why they won
2. Synthesize the best elements from ALL pitches (not just the winner)
3. Extract 3-5 concrete action items with owners and timelines
4. Note any risks or open questions that came up during critique

Be direct and actionable. This becomes the marching orders.`,M=`Topic: ${i}

**Vote Results:**
${A.join("\n")}

**Vote Details:**
${F}

**Winning Pitch (${O}):**
${y[O]||"N/A"}

**All Pitches:**
${Object.entries(y).map(([e,t])=>`[${e}]: ${t.slice(0,500)}`).join("\n\n")}

Deliver the final verdict and action plan.`,W="";B(e,"Henry");try{W=await D(H,M,a,s,m,"Henry")}catch(e){W=`Could not generate summary: ${String(e)}`}B(e,null),J(e,{id:`evt_results_${Date.now()}`,timestamp:new Date().toISOString(),type:"complete",speaker:"Henry",emoji:"🏆",role:"supervisor",text:`**🏆 Competition Results**

${A.join("\n")}

---

${W}`,verdict:"approve",model:a});let z=JSON.parse(v.default.readFileSync(e,"utf-8"));z.status="completed",z.completedAt=new Date().toISOString(),z.outcome="competitive-complete",z.competitive={phase:"complete",pitches:y,votes:b,winner:O,voteTally:$},v.default.writeFileSync(e,JSON.stringify(z,null,2)),(0,S.archiveSession)(z.id||k.default.basename(e,".json")).catch(e=>console.error("Auto-archive failed:",e))}async function Q(e,t,i,r,n,o,a="instant",s=C,l=!1,u,c,d,p,h=P,m){let f=r.includes("Henry")?"Henry":r[0],g=r.filter(e=>e!==f),y=g.length>1?g[g.length-1]:g[0],w=g.filter(e=>e!==y),b=w.length>0?w[0]:g[0];j[h].maxTokens;{if("active"!==JSON.parse(v.default.readFileSync(e,"utf-8")).status)return;let t=L(o,f),r=m?.[f]||h,n=H(f,"review",i,t,r,"supervisor",l,u,c?.[f],d?.[f],p?.[f]),g=`You are commissioning a review session on the following topic/task:

**Topic:** ${i}

As ${"Henry"===f?"Chief of Staff":N[f]?.role||"Supervisor"}, deliver a precise brief to ${b} (the ${N[b]?.role||"worker"}). Your brief must specify:
1. Exactly what deliverable you want
2. The quality bar — what "excellent" looks like
3. Key criteria the reviewer (${y}, ${N[y]?.role||"Reviewer"}) will evaluate against
4. Any specific constraints, format requirements, or angles to cover

Be crisp and exacting. This brief sets the standard for the entire review.`,w="";try{w=await D(n,g,s,l,Math.min(j[r].maxTokens,1024),f)}catch(e){w=`⚠️ ${String(e)}`}let k=N[f];if(J(e,{id:`evt_brief_${Date.now()}`,timestamp:new Date().toISOString(),type:"supervisor",speaker:f,emoji:k?.emoji||"⚡",role:"supervisor",text:`**📋 Review Brief**

${w}`,model:s}),await new Promise(e=>setTimeout(e,500)),!await V(e,a))return}let $="",T=!1,O="strict"===n?3:2;for(let t=1;t<=O&&!T;t++){let r=JSON.parse(v.default.readFileSync(e,"utf-8"));if("active"!==r.status)return;let g=q(r.events||[]),w=L(o,b),k=m?.[b]||h,S=H(b,"review",i,w,k,"author",l,u,c?.[b],d?.[b],p?.[b]),O=1===t?`**Your task:** ${i}

**Brief from ${f}:**
${g}

You are the author/worker presenting your work for review. ${y} (${N[y]?.role||"Reviewer"}) will scrutinize every claim, gap, and assumption.

Produce your strongest possible work. Structure it clearly. Be thorough — a sloppy first submission wastes everyone's time. This is your chance to show ${y} that there's nothing to critique.`:`**Your task:** ${i}

**Full session history (including reviewer feedback):**
${g}

${y} identified specific issues with your previous submission. Now produce a revised version that directly addresses every critique. Be explicit: note what you changed and why. Don't just patch — if the feedback revealed a deeper flaw, fix the root cause.`,R="";try{R=await D(S,O,s,l,j[k].maxTokens,b)}catch(e){R=`⚠️ ${String(e)}`}$=R;let x=N[b];if(J(e,{id:`evt_work_${Date.now()}_${t}`,timestamp:new Date().toISOString(),type:"worker",speaker:b,emoji:x?.emoji||"🔵",role:"worker",text:1===t?`**📄 Submission (v${t})**

${R}`:`**📄 Revised Submission (v${t})**

${R}`,model:s}),1===t){let t=(JSON.parse(v.default.readFileSync(e,"utf-8")).events||[]).filter(e=>"worker"===e.type||"supervisor"===e.type);U(e,i,t,s).catch(console.warn)}if(await new Promise(e=>setTimeout(e,500)),!await V(e,a)||"active"!==JSON.parse(v.default.readFileSync(e,"utf-8")).status)return;let E=L(o,y),I=m?.[y]||h,C=H(y,"review",i,E,I,"reviewer",l,u,c?.[y],d?.[y],p?.[y]),A="strict"===n?"Close your review with a verdict on a new line: VERDICT: APPROVE or VERDICT: REJECT":"flexible"===n?"Close your review with: VERDICT: APPROVE, VERDICT: APPROVE_WITH_CONDITIONS, or VERDICT: REJECT":"Close with your honest bottom line — does this meet the bar or not? Be direct.",P=`**Review Assignment**

**Topic/Task:** ${i}
**Submission by:** ${b} (${N[b]?.role||"Worker"}) — Version ${t}

**Their submission:**
${$}

You are the expert reviewer. Your job is to evaluate this work like a senior principal reviewing a junior's PR, or a partner reviewing an associate's strategy memo. You are NOT trying to be nice — you are trying to make the work better.

**Your review should:**
- Quote or paraphrase specific parts of the submission when you critique them
- Identify logical gaps, missing considerations, unsupported claims, and quality issues
- Be constructive — explain what's wrong AND what good looks like
- Check it against the original brief
- If the work has genuine strengths, acknowledge them briefly — but don't pad

${A}`,F="";try{F=await D(C,P,s,l,j[I].maxTokens,y)}catch(e){F=`⚠️ ${String(e)}`}let _=F.includes("VERDICT: APPROVE")&&!F.includes("VERDICT: REJECT")&&!F.includes("VERDICT: APPROVE_WITH_CONDITIONS"),Y=N[y];if(J(e,{id:`evt_review_${Date.now()}_${t}`,timestamp:new Date().toISOString(),type:_?"approve":"reject",speaker:y,emoji:Y?.emoji||"🟡",role:"reviewer",text:`**🔍 Review (Round ${t})**

${F}`,verdict:_?"approve":"reject",model:s}),await new Promise(e=>setTimeout(e,500)),!await V(e,a))return;if(_){T=!0;break}}{let t=JSON.parse(v.default.readFileSync(e,"utf-8"));if("active"!==t.status)return;let r=q(t.events||[]),n=L(o,f),a=m?.[f]||h,g=H(f,"review",i,n,a,"supervisor",l,u,c?.[f],d?.[f],p?.[f]),y=`**Review session complete.**

**Topic:** ${i}

**Full review session:**
${r}

As ${"Henry"===f?"Chief of Staff":N[f]?.role||"Supervisor"}, deliver your final decision and synthesis:
1. Was the deliverable achieved to the required standard?
2. What were the key strengths and weaknesses surfaced during review?
3. What are the concrete next steps — ship it, revise it, or escalate?
4. Any process observations for future sessions?

Be decisive. No hedging.`,w="";try{w=await D(g,y,s,l,j[a].maxTokens,f)}catch(e){w=`⚠️ ${String(e)}`}let k=N[f];J(e,{id:`evt_decision_${Date.now()}`,timestamp:new Date().toISOString(),type:"complete",speaker:f,emoji:k?.emoji||"⚡",role:"supervisor",text:`**⚖️ Final Decision**

${w}`,verdict:T?"approve":"reject",model:s})}let R=JSON.parse(v.default.readFileSync(e,"utf-8"));R.status="completed",R.completedAt=new Date().toISOString(),R.outcome=T?"approved":"needs-rework",v.default.writeFileSync(e,JSON.stringify(R,null,2)),(0,S.archiveSession)(R.id||k.default.basename(e,".json")).catch(e=>console.error("Auto-archive failed:",e))}async function X(e,t,i){let r=`http://127.0.0.1:${process.env.PORT||3e3}`,n=t.id,o=t.reviewLoop;if(!o?.tasks?.length)return;let a=!1;for(;;){let o=JSON.parse(v.default.readFileSync(e,"utf-8"));if("active"!==o.status)return;let s=o.reviewLoop;if(!s||s.currentTaskIndex>=s.tasks.length)return;let l=s.tasks[s.currentTaskIndex];if(!l)return;let u="rejected"===l.status;try{await fetch(`${r}/api/advisory/sessions/${n}/review-loop`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:u?"retry":"advance"})})}catch(e){console.error("[Advisory] Review loop advance error:",e);break}let c=0;for(;c<120;){await new Promise(e=>setTimeout(e,1e3)),c++;let r=JSON.parse(v.default.readFileSync(e,"utf-8"));if("active"!==r.status)return;let n=r.reviewLoop;if(!n)return;let o=s.currentTaskIndex,l=n.tasks[o];if(!l)break;if("approved"===l.status||"rejected"===l.status){if(!a){a=!0;let n=(r.events||[]).filter(e=>"worker"===e.type||"supervisor"===e.type);U(e,t.topic,n,i).catch(console.warn)}if("rejected"===l.status&&l.attempts>=3)return;break}}}}e.s(["POST",()=>W],87904);var Z=e.i(87904);let ee=new t.AppRouteRouteModule({definition:{kind:i.RouteKind.APP_ROUTE,page:"/api/advisory/sessions/[id]/run/route",pathname:"/api/advisory/sessions/[id]/run",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/projects/panely-app/src/app/api/advisory/sessions/[id]/run/route.ts",nextConfigOutput:"",userland:Z}),{workAsyncStorage:et,workUnitAsyncStorage:ei,serverHooks:er}=ee;function en(){return(0,r.patchFetch)({workAsyncStorage:et,workUnitAsyncStorage:ei})}async function eo(e,t,r){ee.isDev&&(0,n.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let w="/api/advisory/sessions/[id]/run/route";w=w.replace(/\/index$/,"")||"/";let v=await ee.prepare(e,t,{srcPage:w,multiZoneDraftMode:!1});if(!v)return t.statusCode=400,t.end("Bad Request"),null==r.waitUntil||r.waitUntil.call(r,Promise.resolve()),null;let{buildId:k,params:S,nextConfig:b,parsedUrl:$,isDraftMode:T,prerenderManifest:O,routerServerContext:R,isOnDemandRevalidate:x,revalidateOnlyGenerated:E,resolvedPathname:N,clientReferenceManifest:I,serverActionsManifest:C}=v,A=(0,s.normalizeAppPath)(w),D=!!(O.dynamicRoutes[A]||O.routes[N]),j=async()=>((null==R?void 0:R.render404)?await R.render404(e,t,$,!1):t.end("This page could not be found"),null);if(D&&!T){let e=!!O.routes[N],t=O.dynamicRoutes[A];if(t&&!1===t.fallback&&!e){if(b.experimental.adapterPath)return await j();throw new g.NoFallbackError}}let P=null;!D||ee.isDev||T||(P="/index"===(P=N)?"/":P);let F=!0===ee.isDev||!D,_=D&&!F;C&&I&&(0,a.setManifestsSingleton)({page:w,clientReferenceManifest:I,serverActionsManifest:C});let Y=e.method||"GET",H=(0,o.getTracer)(),q=H.getActiveScopeSpan(),U={params:S,prerenderManifest:O,renderOpts:{experimental:{authInterrupts:!!b.experimental.authInterrupts},cacheComponents:!!b.cacheComponents,supportsDynamicResponse:F,incrementalCache:(0,n.getRequestMeta)(e,"incrementalCache"),cacheLifeProfiles:b.cacheLife,waitUntil:r.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,i,r,n)=>ee.onRequestError(e,t,r,n,R)},sharedContext:{buildId:k}},J=new l.NodeNextRequest(e),B=new l.NodeNextResponse(t),M=u.NextRequestAdapter.fromNodeNextRequest(J,(0,u.signalFromNodeResponse)(t));try{let a=async e=>ee.handle(M,U).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let i=H.getRootSpanAttributes();if(!i)return;if(i.get("next.span_type")!==c.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${i.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let r=i.get("next.route");if(r){let t=`${Y} ${r}`;e.setAttributes({"next.route":r,"http.route":r,"next.span_name":t}),e.updateName(t)}else e.updateName(`${Y} ${w}`)}),s=!!(0,n.getRequestMeta)(e,"minimalMode"),l=async n=>{var o,l;let u=async({previousCacheEntry:i})=>{try{if(!s&&x&&E&&!i)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let o=await a(n);e.fetchMetrics=U.renderOpts.fetchMetrics;let l=U.renderOpts.pendingWaitUntil;l&&r.waitUntil&&(r.waitUntil(l),l=void 0);let u=U.renderOpts.collectedTags;if(!D)return await (0,p.sendResponse)(J,B,o,U.renderOpts.pendingWaitUntil),null;{let e=await o.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(o.headers);u&&(t[f.NEXT_CACHE_TAGS_HEADER]=u),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let i=void 0!==U.renderOpts.collectedRevalidate&&!(U.renderOpts.collectedRevalidate>=f.INFINITE_CACHE)&&U.renderOpts.collectedRevalidate,r=void 0===U.renderOpts.collectedExpire||U.renderOpts.collectedExpire>=f.INFINITE_CACHE?void 0:U.renderOpts.collectedExpire;return{value:{kind:y.CachedRouteKind.APP_ROUTE,status:o.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:i,expire:r}}}}catch(t){throw(null==i?void 0:i.isStale)&&await ee.onRequestError(e,t,{routerKind:"App Router",routePath:w,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:_,isOnDemandRevalidate:x})},!1,R),t}},c=await ee.handleResponse({req:e,nextConfig:b,cacheKey:P,routeKind:i.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:O,isRoutePPREnabled:!1,isOnDemandRevalidate:x,revalidateOnlyGenerated:E,responseGenerator:u,waitUntil:r.waitUntil,isMinimalMode:s});if(!D)return null;if((null==c||null==(o=c.value)?void 0:o.kind)!==y.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==c||null==(l=c.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});s||t.setHeader("x-nextjs-cache",x?"REVALIDATED":c.isMiss?"MISS":c.isStale?"STALE":"HIT"),T&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let g=(0,h.fromNodeOutgoingHttpHeaders)(c.value.headers);return s&&D||g.delete(f.NEXT_CACHE_TAGS_HEADER),!c.cacheControl||t.getHeader("Cache-Control")||g.get("Cache-Control")||g.set("Cache-Control",(0,m.getCacheControlHeader)(c.cacheControl)),await (0,p.sendResponse)(J,B,new Response(c.value.body,{headers:g,status:c.value.status||200})),null};q?await l(q):await H.withPropagatedContext(e.headers,()=>H.trace(c.BaseServerSpan.handleRequest,{spanName:`${Y} ${w}`,kind:o.SpanKind.SERVER,attributes:{"http.method":Y,"http.target":e.url}},l))}catch(t){if(t instanceof g.NoFallbackError||await ee.onRequestError(e,t,{routerKind:"App Router",routePath:A,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:_,isOnDemandRevalidate:x})},!1,R),D)throw t;return await (0,p.sendResponse)(J,B,new Response(null,{status:500})),null}}e.s(["handler",()=>eo,"patchFetch",()=>en,"routeModule",()=>ee,"serverHooks",()=>er,"workAsyncStorage",()=>et,"workUnitAsyncStorage",()=>ei],46859)}];

//# sourceMappingURL=b3f68_next_dist_esm_build_templates_app-route_cecf74db.js.map