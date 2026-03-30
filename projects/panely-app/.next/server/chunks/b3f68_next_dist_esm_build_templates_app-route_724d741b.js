module.exports=[59520,e=>{"use strict";var t=e.i(39894),r=e.i(90451),o=e.i(79630),s=e.i(19874),i=e.i(1016),a=e.i(48339),n=e.i(28263),u=e.i(93896),p=e.i(26091),d=e.i(83056),l=e.i(35766),c=e.i(82794),v=e.i(72786),w=e.i(50081),m=e.i(15802),g=e.i(93695);e.i(18130);var f=e.i(53630),h=e.i(2168),R=e.i(22734),k=e.i(14747),x=e.i(24297),$=e.i(72493);let y=k.default.join(process.cwd(),"data","advisory"),A={Henry:"henry",Atlas:"t1",Nimbus:"t2",Cipher:"t3",Quant:"quant",Forge:"backend",Pixel:"fullstack",Scout:"scout",Quill:"quill",Counsel:"counsel"},j=function(){let e={};for(let[t,r]of Object.entries(A)){let o=x.AGENT_CONFIGS.find(e=>e.id===r);o&&(e[t]={name:t,emoji:o.emoji,role:o.role,expertise:o.description,persona:o.persona})}return e}();async function E(e,t,r,o){let s=await (0,$.spawnAdvisoryAgentWithRetry)({sessionId:e,agentId:`reviewloop-${t}`,systemPrompt:r,userPrompt:o,timeoutSeconds:120});return{text:s.text,model:s.model}}function S(e){return JSON.parse(R.default.readFileSync(e,"utf-8"))}function T(e,t){R.default.writeFileSync(e,JSON.stringify(t,null,2))}function N(e,t){let r=S(e);r.events=[...r.events||[],t],T(e,r)}function C(e,t){try{let r=S(e);r.thinkingAgent=t,T(e,r)}catch{}}async function I(e,{params:t}){let{id:r}=await t,o=k.default.join(y,`${r}.json`);if(!R.default.existsSync(o))return h.NextResponse.json({error:"Session not found"},{status:404});let s=S(o);return h.NextResponse.json({reviewLoop:s.reviewLoop||null,status:s.status,paused:s.reviewLoop?.paused??!1})}async function b(e,{params:t}){let{id:r}=await t,o=k.default.join(y,`${r}.json`);if(!R.default.existsSync(o))return h.NextResponse.json({error:"Session not found"},{status:404});let s=await e.json(),{action:i}=s,a=S(o),n=a.topic;if("start"===i){if("active"!==a.status)return h.NextResponse.json({error:"Session is not active"},{status:400});let e=a.reviewLoop;return e?(N(o,{id:`evt_loop_start_${Date.now()}`,timestamp:new Date().toISOString(),type:"start",speaker:e.supervisorAgent,emoji:j[e.supervisorAgent]?.emoji||"⚡",role:"supervisor",text:`🚀 **Review Loop Started**

**Topic:** ${n}

**Worker:** ${e.workerAgent} \xb7 **Reviewer:** ${e.reviewerAgent} \xb7 **Supervisor:** ${e.supervisorAgent}
**Tasks:** ${e.tasks.length} \xb7 **Auto-Continue:** ${e.autoContinue?"ON":"OFF"} \xb7 **Max Retries:** ${e.maxRetries}

Beginning task #1...`}),L(o,r,n).catch(console.error),h.NextResponse.json({ok:!0,message:"Loop started"})):h.NextResponse.json({error:"No reviewLoop configured"},{status:400})}if("advance"===i){if("active"!==a.status)return h.NextResponse.json({error:"Session is not active"},{status:400});let e=a.reviewLoop;return e?(e.paused&&(e.paused=!1,a.reviewLoop=e,T(o,a)),L(o,r,n).catch(console.error),h.NextResponse.json({ok:!0,message:"Loop advancing"})):h.NextResponse.json({error:"No reviewLoop configured"},{status:400})}if("override"===i){let{taskId:e,newStatus:t,notes:r}=s,i=a.reviewLoop;if(!i)return h.NextResponse.json({error:"No reviewLoop configured"},{status:400});let n=i.tasks.findIndex(t=>t.id===e);if(-1===n)return h.NextResponse.json({error:"Task not found"},{status:404});let u=i.tasks[n],p=u.status;return u.status=t,u.overriddenBy="Tim",r&&(u.notes=r),"approved"===t&&"approved"!==p&&(i.totalApproved+=1,n===i.currentTaskIndex&&(i.currentTaskIndex+=1)),"approved"===p&&"approved"!==t&&(i.totalApproved=Math.max(0,i.totalApproved-1)),i.tasks[n]=u,a.reviewLoop=i,T(o,a),N(o,{id:`evt_override_${Date.now()}_t${e}`,timestamp:new Date().toISOString(),type:"approved"===t?"approve":"supervisor",speaker:"Tim",emoji:"✋",role:"supervisor",text:`**✋ Human Override — Task #${e}:** ${u.description}

Status changed from **${p}** → **${t}**${r?`

**Notes:** ${r}`:""}`,taskId:e,verdict:"approved"===t?"approve":void 0}),h.NextResponse.json({ok:!0,reviewLoop:i})}if("pause"===i){let e=a.reviewLoop;return e?(e.paused=!0,a.reviewLoop=e,T(o,a),N(o,{id:`evt_pause_${Date.now()}`,timestamp:new Date().toISOString(),type:"supervisor",speaker:"Tim",emoji:"⏸️",role:"supervisor",text:"**⏸️ Loop Paused** — Waiting for human to resume."}),h.NextResponse.json({ok:!0,paused:!0})):h.NextResponse.json({error:"No reviewLoop configured"},{status:400})}if("resume"===i){let e=a.reviewLoop;return e?(e.paused=!1,a.reviewLoop=e,T(o,a),N(o,{id:`evt_resume_${Date.now()}`,timestamp:new Date().toISOString(),type:"supervisor",speaker:"Tim",emoji:"▶️",role:"supervisor",text:"**▶️ Loop Resumed** — Continuing execution."}),e.autoContinue&&L(o,r,n).catch(console.error),h.NextResponse.json({ok:!0,paused:!1})):h.NextResponse.json({error:"No reviewLoop configured"},{status:400})}if("add-task"===i){let{description:e,insertAfter:t}=s;if(!e?.trim())return h.NextResponse.json({error:"Task description is required"},{status:400});let r=a.reviewLoop;if(!r)return h.NextResponse.json({error:"No reviewLoop configured"},{status:400});let i={id:r.tasks.reduce((e,t)=>Math.max(e,t.id),0)+1,description:e.trim(),status:"pending",attempts:0,notes:"",overriddenBy:null};if("number"==typeof t){let e=r.tasks.findIndex(e=>e.id===t);-1!==e?r.tasks.splice(e+1,0,i):r.tasks.push(i)}else r.tasks.push(i);return a.reviewLoop=r,T(o,a),N(o,{id:`evt_addtask_${Date.now()}_t${i.id}`,timestamp:new Date().toISOString(),type:"supervisor",speaker:"Tim",emoji:"➕",role:"supervisor",text:`**➕ Task Added:** #${i.id} — ${i.description}`,taskId:i.id}),h.NextResponse.json({ok:!0,task:i,reviewLoop:r})}if("supervisor-check"===i){let e=a.reviewLoop;return e?(O(o,e,n,model).catch(console.error),h.NextResponse.json({ok:!0,message:"Supervisor check triggered"})):h.NextResponse.json({error:"No reviewLoop configured"},{status:400})}if("set-auto-continue"===i){let e=a.reviewLoop;return e?(e.autoContinue=!!s.autoContinue,a.reviewLoop=e,T(o,a),h.NextResponse.json({ok:!0,autoContinue:e.autoContinue})):h.NextResponse.json({error:"No reviewLoop configured"},{status:400})}return h.NextResponse.json({error:`Unknown action: ${i}`},{status:400})}async function L(e,t,r){var o,s,i,a;let n,u,p,d,l,c,v=S(e),w=v.reviewLoop;if(w.paused||"active"!==v.status)return;let m=w.currentTaskIndex,g=w.tasks[m];if(!g){await new Promise(e=>setTimeout(e,500)),await O(e,t,w,r),(v=S(e)).status="completed",v.completedAt=new Date().toISOString(),v.outcome="review-loop-complete",T(e,v);return}if("approved"===g.status||"blocked"===g.status)return(w.currentTaskIndex+=1,v.reviewLoop=w,T(e,v),w.autoContinue&&!w.paused)?(await new Promise(e=>setTimeout(e,300)),L(e,t,r)):void 0;let f="rejected"===g.status||"retrying"===g.status;g.status="in-progress",g.attempts+=1,w.tasks[m]=g,v.reviewLoop=w,T(e,v);let h=f?g.reviewerFeedback:void 0,{system:R,user:k}=(o=w.workerAgent,u=(n=j[o])?`You are ${n.name} ${n.emoji}, the ${n.role} at Harris Autonomous.
Your expertise: ${n.expertise}

${n.persona}`:`You are ${o}, an AI agent at Harris Autonomous.`,p=`${u}

---

**YOUR ROLE: WORKER**

You are executing tasks in a structured review loop. A Reviewer will check your work after you submit — they will approve or reject with specific feedback.

**How to operate:**
- Complete the assigned task thoroughly and precisely
- Be specific and actionable — vague work will be rejected
- If this is a retry after rejection, directly address EVERY piece of feedback
- Show your work clearly so the reviewer can evaluate it
- Do not pad with unnecessary caveats — deliver the work product

**Session topic:** ${r}`,d=h?`

**PREVIOUS ATTEMPT WAS REJECTED. Reviewer feedback:**
${h}

Address every point above. Be explicit about what you changed.`:"",{system:p,user:`**Task #${g.id}: ${g.description}**${d}${g.notes?`

**Notes:** ${g.notes}`:""}

Complete this task now. Deliver your work product.`});C(e,w.workerAgent);let x="",$="openclaw-agent";try{let e=await E(t,w.workerAgent,R,k);x=e.text,$=e.model}catch(e){x=`⚠️ Failed to generate response: ${String(e)}`}C(e,null),g.workerOutput=x,(w=(v=S(e)).reviewLoop).tasks[m]=g,v.reviewLoop=w,T(e,v);let y=j[w.workerAgent];if(N(e,{id:`evt_work_${Date.now()}_t${g.id}`,timestamp:new Date().toISOString(),type:"worker",speaker:w.workerAgent,emoji:y?.emoji||"🔵",role:"worker",text:`**📄 Task #${g.id}${f?` (Attempt ${g.attempts})`:""}:** ${g.description}

${x}`,taskId:g.id,model:$}),await new Promise(e=>setTimeout(e,500)),w=(v=S(e)).reviewLoop,"active"!==v.status||w.paused)return;g.status="in-review",w.tasks[m]=g,v.reviewLoop=w,T(e,v);let{system:A,user:I}=(s=x,i=w.reviewerAgent,a=w.workerAgent,c=(l=j[i])?`You are ${l.name} ${l.emoji}, the ${l.role} at Harris Autonomous.
Your expertise: ${l.expertise}

${l.persona}`:`You are ${i}, an AI agent at Harris Autonomous.`,{system:`${c}

---

**YOUR ROLE: REVIEWER**

You are reviewing work submitted by ${a} in a structured review loop. Your job is to evaluate whether the work meets the bar — approve it or reject it with specific, actionable feedback.

**How to review:**
- Evaluate the work against the task requirements
- Be specific: quote or reference exact parts you're critiquing
- If rejecting, explain exactly what needs to change and why
- Don't reject for style preferences — reject for substance issues
- If the work is good enough, approve it. Don't create busywork.

**You MUST end your review with exactly one of these on its own line:**
VERDICT: APPROVE
VERDICT: REJECT

**Session topic:** ${r}`,user:`**Task #${g.id}: ${g.description}**

**${a}'s submission (attempt ${g.attempts}):**

${s}

Review this work. Is it complete, correct, and sufficient? End with your VERDICT.`});C(e,w.reviewerAgent);let b="",D="openclaw-agent";try{let e=await E(t,w.reviewerAgent,A,I);b=e.text,D=e.model}catch(e){b=`⚠️ Failed to generate review: ${String(e)}`}C(e,null);let P=b.includes("VERDICT: APPROVE")&&!b.includes("VERDICT: REJECT");w=(v=S(e)).reviewLoop,P?(g.status="approved",g.reviewerFeedback=b,w.totalApproved+=1,w.currentTaskIndex+=1):(g.status="rejected",g.reviewerFeedback=b,w.totalRejected+=1),w.tasks[m]=g,v.reviewLoop=w,T(e,v);let _=j[w.reviewerAgent];if(N(e,{id:`evt_review_${Date.now()}_t${g.id}`,timestamp:new Date().toISOString(),type:P?"approve":"reject",speaker:w.reviewerAgent,emoji:_?.emoji||"🟡",role:"reviewer",text:`**${P?"🟢 Approved":"🔴 Rejected"} — Task #${g.id}:** ${g.description}

${b}`,verdict:P?"approve":"reject",taskId:g.id,model:D}),P&&w.totalApproved>0&&w.totalApproved%w.supervisorInterval==0&&(await new Promise(e=>setTimeout(e,500)),await O(e,t,w,r)),w=(v=S(e)).reviewLoop,"active"===v.status&&!w.paused){if(P){if(w.currentTaskIndex>=w.tasks.length){await new Promise(e=>setTimeout(e,500)),await O(e,t,w,r),(v=S(e)).status="completed",v.completedAt=new Date().toISOString(),v.outcome="review-loop-complete",T(e,v);return}if(w.autoContinue&&!w.paused)return await new Promise(e=>setTimeout(e,500)),L(e,t,r)}else if(g.attempts<w.maxRetries&&w.autoContinue&&!w.paused)return g.status="retrying",w.tasks[m]=g,(v=S(e)).reviewLoop=w,T(e,v),await new Promise(e=>setTimeout(e,500)),L(e,t,r)}}async function O(e,t,r,o){let s,i,a,n,u,p,d,l=S(e).reviewLoop||r,{system:c,user:v}=(i=(s=j[l.supervisorAgent])?`You are ${s.name} ${s.emoji}, the ${s.role} at Harris Autonomous.
Your expertise: ${s.expertise}

${s.persona}`:`You are ${l.supervisorAgent}, an AI agent at Harris Autonomous.`,a={pending:"⬜","in-progress":"🔄","in-review":"👀",approved:"✅",rejected:"❌",retrying:"🔁",blocked:"⏸️"},n=l.tasks.map(e=>`${a[e.status]||"⬜"} Task #${e.id}: ${e.description} [${e.status}, ${e.attempts} attempt(s)]${e.overriddenBy?" ✋ OVERRIDDEN":""}`).join("\n"),u=`${i}

---

**YOUR ROLE: SUPERVISOR**

You are overseeing a structured review loop where ${l.workerAgent} executes tasks and ${l.reviewerAgent} reviews them. Provide a brief status update on overall progress.

**Session topic:** ${o}`,d=(p=l.tasks.length)>0?Math.round(l.totalApproved/p*100):0,{system:u,user:`**Progress Report**

${l.totalApproved} of ${p} tasks completed (${d}%)
Rejected: ${l.totalRejected} total rejections across all tasks

**Task Status:**
${n}

Provide a brief supervisor status update: what's going well, any concerns, and recommendations. Keep it concise (2-3 paragraphs max).`});C(e,l.supervisorAgent);let w="",m="openclaw-agent";try{let e=await E(t,l.supervisorAgent,c,v);w=e.text,m=e.model}catch(e){w=`⚠️ Supervisor check failed: ${String(e)}`}C(e,null);let g=j[l.supervisorAgent];N(e,{id:`evt_supervisor_${Date.now()}`,timestamp:new Date().toISOString(),type:"supervisor",speaker:l.supervisorAgent,emoji:g?.emoji||"🟠",role:"supervisor",text:`**📋 Supervisor Status Update**

${w}`,model:m})}e.s(["GET",()=>I,"POST",()=>b],35685);var D=e.i(35685);let P=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/advisory/sessions/[id]/review-loop/route",pathname:"/api/advisory/sessions/[id]/review-loop",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/projects/panely-app/src/app/api/advisory/sessions/[id]/review-loop/route.ts",nextConfigOutput:"",userland:D}),{workAsyncStorage:_,workUnitAsyncStorage:H,serverHooks:U}=P;function q(){return(0,o.patchFetch)({workAsyncStorage:_,workUnitAsyncStorage:H})}async function F(e,t,o){P.isDev&&(0,s.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let h="/api/advisory/sessions/[id]/review-loop/route";h=h.replace(/\/index$/,"")||"/";let R=await P.prepare(e,t,{srcPage:h,multiZoneDraftMode:!1});if(!R)return t.statusCode=400,t.end("Bad Request"),null==o.waitUntil||o.waitUntil.call(o,Promise.resolve()),null;let{buildId:k,params:x,nextConfig:$,parsedUrl:y,isDraftMode:A,prerenderManifest:j,routerServerContext:E,isOnDemandRevalidate:S,revalidateOnlyGenerated:T,resolvedPathname:N,clientReferenceManifest:C,serverActionsManifest:I}=R,b=(0,n.normalizeAppPath)(h),L=!!(j.dynamicRoutes[b]||j.routes[N]),O=async()=>((null==E?void 0:E.render404)?await E.render404(e,t,y,!1):t.end("This page could not be found"),null);if(L&&!A){let e=!!j.routes[N],t=j.dynamicRoutes[b];if(t&&!1===t.fallback&&!e){if($.experimental.adapterPath)return await O();throw new g.NoFallbackError}}let D=null;!L||P.isDev||A||(D="/index"===(D=N)?"/":D);let _=!0===P.isDev||!L,H=L&&!_;I&&C&&(0,a.setManifestsSingleton)({page:h,clientReferenceManifest:C,serverActionsManifest:I});let U=e.method||"GET",q=(0,i.getTracer)(),F=q.getActiveScopeSpan(),M={params:x,prerenderManifest:j,renderOpts:{experimental:{authInterrupts:!!$.experimental.authInterrupts},cacheComponents:!!$.cacheComponents,supportsDynamicResponse:_,incrementalCache:(0,s.getRequestMeta)(e,"incrementalCache"),cacheLifeProfiles:$.cacheLife,waitUntil:o.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,o,s)=>P.onRequestError(e,t,o,s,E)},sharedContext:{buildId:k}},Y=new u.NodeNextRequest(e),V=new u.NodeNextResponse(t),B=p.NextRequestAdapter.fromNodeNextRequest(Y,(0,p.signalFromNodeResponse)(t));try{let a=async e=>P.handle(B,M).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=q.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==d.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let o=r.get("next.route");if(o){let t=`${U} ${o}`;e.setAttributes({"next.route":o,"http.route":o,"next.span_name":t}),e.updateName(t)}else e.updateName(`${U} ${h}`)}),n=!!(0,s.getRequestMeta)(e,"minimalMode"),u=async s=>{var i,u;let p=async({previousCacheEntry:r})=>{try{if(!n&&S&&T&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let i=await a(s);e.fetchMetrics=M.renderOpts.fetchMetrics;let u=M.renderOpts.pendingWaitUntil;u&&o.waitUntil&&(o.waitUntil(u),u=void 0);let p=M.renderOpts.collectedTags;if(!L)return await (0,c.sendResponse)(Y,V,i,M.renderOpts.pendingWaitUntil),null;{let e=await i.blob(),t=(0,v.toNodeOutgoingHttpHeaders)(i.headers);p&&(t[m.NEXT_CACHE_TAGS_HEADER]=p),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==M.renderOpts.collectedRevalidate&&!(M.renderOpts.collectedRevalidate>=m.INFINITE_CACHE)&&M.renderOpts.collectedRevalidate,o=void 0===M.renderOpts.collectedExpire||M.renderOpts.collectedExpire>=m.INFINITE_CACHE?void 0:M.renderOpts.collectedExpire;return{value:{kind:f.CachedRouteKind.APP_ROUTE,status:i.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:o}}}}catch(t){throw(null==r?void 0:r.isStale)&&await P.onRequestError(e,t,{routerKind:"App Router",routePath:h,routeType:"route",revalidateReason:(0,l.getRevalidateReason)({isStaticGeneration:H,isOnDemandRevalidate:S})},!1,E),t}},d=await P.handleResponse({req:e,nextConfig:$,cacheKey:D,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:j,isRoutePPREnabled:!1,isOnDemandRevalidate:S,revalidateOnlyGenerated:T,responseGenerator:p,waitUntil:o.waitUntil,isMinimalMode:n});if(!L)return null;if((null==d||null==(i=d.value)?void 0:i.kind)!==f.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==d||null==(u=d.value)?void 0:u.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});n||t.setHeader("x-nextjs-cache",S?"REVALIDATED":d.isMiss?"MISS":d.isStale?"STALE":"HIT"),A&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let g=(0,v.fromNodeOutgoingHttpHeaders)(d.value.headers);return n&&L||g.delete(m.NEXT_CACHE_TAGS_HEADER),!d.cacheControl||t.getHeader("Cache-Control")||g.get("Cache-Control")||g.set("Cache-Control",(0,w.getCacheControlHeader)(d.cacheControl)),await (0,c.sendResponse)(Y,V,new Response(d.value.body,{headers:g,status:d.value.status||200})),null};F?await u(F):await q.withPropagatedContext(e.headers,()=>q.trace(d.BaseServerSpan.handleRequest,{spanName:`${U} ${h}`,kind:i.SpanKind.SERVER,attributes:{"http.method":U,"http.target":e.url}},u))}catch(t){if(t instanceof g.NoFallbackError||await P.onRequestError(e,t,{routerKind:"App Router",routePath:b,routeType:"route",revalidateReason:(0,l.getRevalidateReason)({isStaticGeneration:H,isOnDemandRevalidate:S})},!1,E),L)throw t;return await (0,c.sendResponse)(Y,V,new Response(null,{status:500})),null}}e.s(["handler",()=>F,"patchFetch",()=>q,"routeModule",()=>P,"serverHooks",()=>U,"workAsyncStorage",()=>_,"workUnitAsyncStorage",()=>H],59520)}];

//# sourceMappingURL=b3f68_next_dist_esm_build_templates_app-route_724d741b.js.map