module.exports=[22734,(e,r,t)=>{r.exports=e.x("fs",()=>require("fs"))},93695,(e,r,t)=>{r.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},70406,(e,r,t)=>{r.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},18622,(e,r,t)=>{r.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},24725,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},14747,(e,r,t)=>{r.exports=e.x("path",()=>require("path"))},33405,(e,r,t)=>{r.exports=e.x("child_process",()=>require("child_process"))},72493,e=>{"use strict";var r=e.i(33405);async function t(e,s=2){let n=null;for(let t=0;t<=s;t++)try{return await function(e){let{sessionId:t,agentId:s,systemPrompt:n,userPrompt:a,timeoutSeconds:o=120,thinkingLevel:i}=e,p=Date.now().toString(36)+Math.random().toString(36).slice(2,6),l=`advisory-${t}-${s}-${p}`,d=["agent","--session-id",l,"--message",`=== ADVISORY BOARD: ROLE OVERRIDE ===
IMPORTANT: For this response, you are NOT Henry. You must fully adopt the following identity and respond ONLY as this character. Do not mention Henry or break character.

${n}

=== END ROLE OVERRIDE ===

=== DISCUSSION TASK ===

${a}

=== END TASK ===

Respond as ${s} only. Stay fully in character.`,"--json","--local","--timeout",String(o)];return i&&"off"!==i&&d.push("--thinking",i),new Promise((e,t)=>{(0,r.execFile)("openclaw",d,{maxBuffer:0x3200000,timeout:(o+10)*1e3},(r,n,a)=>{if(r){let e=a?.trim()||r.message;t(Error(`OpenClaw agent spawn failed for ${s}: ${e}`));return}let o=n?.trim()||"";if(!o||!o.startsWith("{")){let e=a||"",r=e.indexOf("\n{");r>=0&&(o=e.slice(r+1).trim())}try{let r=JSON.parse(o),t=r?.payloads?.[0]?.text||"",s=r?.meta?.agentMeta||{};e({text:t,model:s.model||"unknown",durationMs:r?.meta?.durationMs||0,openclawSessionId:s.sessionId||l})}catch(i){let r=o.match(/"text":\s*"((?:[^"\\]|\\.)*)"/);r?e({text:JSON.parse(`"${r[1]}"`),model:"unknown",durationMs:0,openclawSessionId:l}):n?.trim()?e({text:n.trim(),model:"unknown",durationMs:0,openclawSessionId:l}):t(Error(`Failed to parse OpenClaw response for ${s}: ${String(i)}
stdout: ${n?.slice(0,500)}
stderr: ${a?.slice(0,500)}`))}}).on("error",e=>{t(Error(`OpenClaw agent process error for ${s}: ${e.message}`))})})}(e)}catch(r){if(n=r instanceof Error?r:Error(String(r)),t<s){let r=1e3*Math.pow(2,t);console.warn(`[Advisory] Agent spawn failed for ${e.agentId}, retrying in ${r}ms (attempt ${t+1}/${s})...`,n.message),await new Promise(e=>setTimeout(e,r))}}throw n||Error("Max retries exceeded")}e.s(["spawnAdvisoryAgentWithRetry",()=>t])}];

//# sourceMappingURL=%5Broot-of-the-server%5D__481397fe._.js.map