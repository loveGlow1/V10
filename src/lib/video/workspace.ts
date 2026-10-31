/* Videos in the workspace — the same screen a website is built in.
 *
 * A video made from Home is a project like any other: the chat on one side,
 * the preview iframe on the other. What differs is the engine behind a
 * message:
 *
 *   first message      the Creative Director plans the video from the brief
 *                      and the choices made on Home, then every clip and
 *                      voice line is sent to render (plan-video.ts,
 *                      start-render.ts)
 *   every message after the plan revised with that change — a new version —
 *                      and rendered again
 *
 * The planning runs after the response, the way a website build runs in the
 * orchestrator: the project says Building, the chat waits on it, and when the
 * plan is made and the render sent the project is stamped Built and the
 * preview reloads.
 *
 * The clips land one by one over the next minutes, long after that. So the
 * preview is live by itself: the board (videoBoardHtml) asks the video's state
 * from /api/video/{id}/board every few seconds with a token made for this
 * video, plays whatever has landed in order — clip, voice line and caption
 * per scene — and swaps to the one-file cut when there is one. */

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { currentBalance } from "@/lib/credits-server";
import { recordMessage } from "@/lib/thread-server";

import { falToken, verifyFalToken } from "./fal";
import { editVideo } from "./apply-edit";
import { planVideo } from "./plan-video";
import { startRender } from "./start-render";

export const VIDEO_INTENT = "video";

/** The token that lets a video's own preview board read its state. */
export const boardToken = (videoId: string) => falToken(videoId, 0, "board");
export const verifyBoardToken = (videoId: string, token: unknown) => verifyFalToken(videoId, 0, "board", token);

/* A message that only asks for the current plan to be rendered. */
const RENDER_ONLY = /^(please\s+)?(render|generate|make|create|produce)(\s+(it|this|the video|the clips|now|again|it now|it again))*[.!]?$/i;

async function balanceOf(client: SupabaseClient, userId: string): Promise<string> {
  const balance = await currentBalance(client, userId).catch(() => null);
  if (!balance) return "too few";
  const total = balance.daily + balance.rollover + balance.monthly + balance.topUp;
  return `${Math.floor(total * 10) / 10} credits`;
}

export type VideoTurn = { ok: true; message: string } | { ok: false; status: number; error: string };

/** One chat message on a video project: plan (or re-plan) it, then render. */
export async function startVideoTurn(input: {
  supabase: SupabaseClient;
  service: SupabaseClient | null;
  userId: string;
  project: { id: string };
  prompt: string;
  requestId: string;
  origin: string;
}): Promise<VideoTurn> {
  const { supabase, service, userId, project, prompt, origin } = input;
  const { data: video } = await supabase
    .from("video_projects")
    .select("id, current_version, status, brief")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; current_version: number; status: string; brief: string | null }>();
  if (!video) return { ok: false, status: 404, error: "This video's settings are missing. Start it again from the Video tab on Home." };
  if (video.status === "rendering") {
    return { ok: false, status: 409, error: "The last version is still rendering — its clips are landing in the preview. Ask for the change once it finishes." };
  }

  const writer = service ?? supabase;
  await writer.from("projects").update({ status: "Building", prompt: prompt.slice(0, 2000) }).eq("id", project.id);
  if (service) await recordMessage(service, { projectId: project.id, userId, role: "you", body: prompt, dedupeKey: `you:${input.requestId}` });

  const first = !video.current_version;
  /* "Render it" on a plan that is already made: send it to render as it is,
     without planning it again (and charging for a plan nobody asked for). */
  const renderOnly = !first && RENDER_ONLY.test(prompt.trim());
  after(async () => {
    const finish = async (ok: boolean, body: string) => {
      await writer.from("projects").update({ status: ok ? "Built" : "Failed", last_build_at: new Date().toISOString() }).eq("id", project.id);
      if (service) {
        await recordMessage(service, {
          projectId: project.id,
          userId,
          role: "system",
          kind: ok ? "build_ready" : "build_failed",
          tone: ok ? "normal" : "error",
          body,
          dedupeKey: `video:${input.requestId}`,
        });
      }
    };

    let plan: { version?: number; plan?: { scenes?: unknown[]; target?: number }; error?: string } | null;
    if (renderOnly) {
      const { data: current } = await writer.from("video_versions").select("version, plan").eq("video_id", video.id).eq("version", video.current_version).maybeSingle();
      plan = current ? { version: current.version as number, plan: current.plan as { scenes?: unknown[] } } : null;
    } else {
      /* A video already made is edited, not planned again: only what the
         message asks for changes, and every clip and line that was right is
         reused (apply-edit.ts). Null means it is not an edit — plan it. */
      if (!first) {
        const edited = await editVideo({ writer, userId, videoId: video.id, instruction: prompt, origin });
        if (edited) {
          await finish(edited.ok, edited.message);
          return;
        }
      }
      /* Before the first plan, a message other than the brief itself is the
         person filling in its blanks. */
      const fill = first && prompt.trim() && prompt.trim() !== (video.brief ?? "").trim() ? prompt : undefined;
      const planned = await planVideo(writer, userId, video.id, first ? { fill } : { note: prompt });
      plan = (await planned.json().catch(() => null)) as typeof plan;
      if (!planned.ok) plan = { error: plan?.error };
    }
    if (!plan?.version) {
      await finish(false, plan?.error ?? "The video could not be planned this time. Nothing was charged — try again in a moment.");
      return;
    }
    const scenes = plan.plan?.scenes?.length ?? 0;
    const rendered = await startRender(writer, userId, video.id, {}, origin);
    const render = (await rendered.json().catch(() => null)) as { error?: string; missing?: { label: string }[] } | null;
    if (!rendered.ok) {
      const why =
        rendered.status === 402
          ? `${(render?.error ?? "You don't have enough credits to render it.").replace(/\.+$/, "")} — you have ${await balanceOf(writer, userId)}. Top up, then say "render it" and it renders this exact plan.`
          : `The render could not start: ${(render?.error ?? "try again in a moment").replace(/\.+$/, "")}${render?.missing?.length ? ` (needs ${render.missing.map((m) => m.label).join(", ")})` : ""}. Say "render it" to try again.`;
      await finish(true, `Planned version ${plan.version} — ${scenes} scenes. ${why} Until then the preview plays the plan as text, without clips or voice.`);
      return;
    }
    await finish(
      true,
      `${first ? "Planned" : "Changed"} — version ${plan.version}, ${scenes} scenes. The clips are rendering now and appear in the preview as each one lands, usually 2–4 minutes. Tell me anything to change.`,
    );
  });

  return {
    ok: true,
    message: first
      ? "Planning your video, then sending every scene to render…"
      : renderOnly
        ? "Sending this version to render…"
        : "Working on that change…",
  };
}

/* ── The preview document ─────────────────────────────────────────────── */

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** The live, interactive preview of one video. Pure: the page fetches its own state. */
export function videoBoardHtml(input: { videoId: string | null; token: string; origin: string; title: string }): string {
  const feed = input.videoId ? `${input.origin}/api/video/${input.videoId}/board?t=${input.token}` : "";
  return `<!doctype html><html lang="en" data-qs-video-board><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(input.title || "Video")}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}html,body{overflow-x:hidden;max-width:100%}body{margin:0;background:#0b0b0d;color:#f4f4f5;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px 14px 36px}
.wrap{width:100%;max-width:980px;margin:0 auto;min-width:0}h1,#status{overflow-wrap:anywhere}.eyebrow{margin:0;color:#a1a1aa;font-size:12px;letter-spacing:.04em;text-transform:uppercase}h1{margin:4px 0 4px;font-size:21px;line-height:1.25}
#status{margin:0 0 14px;color:#a1a1aa;font-size:13.5px}
.stage{position:relative;margin:0 auto;background:#000;border-radius:16px;overflow:hidden;max-width:100%}
.stage video{width:100%;height:100%;object-fit:cover;display:block;background:#000}
.card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;background:linear-gradient(120deg,#17171c,#24212f 40%,#17171c 80%);background-size:300% 100%}
.card.busy{animation:sheen 2.6s ease-in-out infinite}@keyframes sheen{0%{background-position:100% 0}100%{background-position:0 0}}
.card .spin{width:26px;height:26px;border-radius:99px;border:2.5px solid #3f3f46;border-top-color:#f4f4f5;animation:r .9s linear infinite}.card.busy .spin{display:block}.card .spin{display:none}@keyframes r{to{transform:rotate(360deg)}}
.card b{font-size:17px;line-height:1.3;font-weight:600}.card span{max-width:34ch;color:#a1a1aa;font-size:13.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.prog{height:4px;background:#27272a;border-radius:4px;overflow:hidden;margin:0 0 6px}.prog i{display:block;height:100%;width:0;background:#f4f4f5;border-radius:4px;transition:width .6s ease}
#note{margin:0 0 14px;color:#71717a;font-size:12.5px}
.ost{position:absolute;left:0;right:0;top:12%;text-align:center;padding:0 16px;font-weight:800;font-size:clamp(18px,4.5vw,30px);text-shadow:0 2px 12px rgba(0,0,0,.8)}
.cap{position:absolute;left:8%;right:8%;bottom:7%;text-align:center;background:rgba(0,0,0,.6);border-radius:10px;padding:6px 10px;font-size:14px}
.bar{display:flex;align-items:center;gap:10px;margin:12px auto 0;max-width:100%}.play{width:44px;height:44px;border-radius:999px;border:0;background:#f4f4f5;color:#111;font-size:16px;cursor:pointer}
.track{flex:1;height:4px;background:#27272a;border-radius:4px;overflow:hidden}.track i{display:block;height:100%;width:0;background:#f97316}
.time{color:#a1a1aa;font-size:12px;min-width:64px;text-align:right}
h2{margin:26px 0 8px;font-size:15px}.scenes{display:grid;gap:8px;grid-template-columns:minmax(0,1fr)}
.scene{display:flex;gap:10px;align-items:center;min-width:0;border:1px solid #27272a;border-radius:12px;padding:8px 10px;background:#111113;cursor:pointer}
.scene.on{border-color:#52525b}.dot{width:8px;height:8px;border-radius:8px;flex:none;background:#3f3f46}.dot.done{background:#22c55e}.dot.run{background:#a1a1aa;animation:p 1.2s infinite}.dot.fail{background:#71717a}@keyframes p{50%{opacity:.3}}
.tag{flex:none;color:#71717a;font-size:12px}
.scene p{margin:0;font-size:13px;color:#d4d4d8;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.scene a{color:#f97316;font-size:12px;text-decoration:none}
.empty{max-width:420px;margin:70px auto;text-align:center;color:#a1a1aa}
.exports{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:12px 0 0}.exports:empty{display:none}.exports a{display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:999px;border:1px solid #3f3f46;color:#e4e4e7;font-size:13px;text-decoration:none}
</style></head><body><div class="wrap">
<p class="eyebrow">Video</p><h1 id="title">${escape(input.title || "Your video")}</h1><p id="status">Loading…</p><div class="prog" id="progwrap" hidden><i id="progall"></i></div><p id="note" hidden></p>
<div id="player" hidden><div class="stage" id="stage"><video id="clip" playsinline muted></video><div class="card" id="card"><div class="spin"></div><b></b><span></span></div><div class="ost" id="ost"></div><div class="cap" id="cap" hidden></div></div>
<div class="bar" id="bar"><button class="play" id="play" aria-label="Play">▶</button><div class="track"><i id="prog"></i></div><span class="time" id="time">0s</span></div>
<audio id="voice"></audio></div>
<div id="final" hidden><video id="finalv" controls playsinline style="width:100%;max-height:70vh;border-radius:16px;background:#000"></video><p style="margin:12px 0 0;text-align:center"><a id="finaldl" class="dl" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;height:42px;padding:0 20px;border-radius:999px;background:#f97316;color:#111;font-weight:600;text-decoration:none">Download MP4</a></p><div id="exports" class="exports"></div></div>
<h2 id="sh" hidden>Scenes</h2><div class="scenes" id="scenes"></div>
<p class="empty" id="empty" hidden>Describe your video in the chat to plan it.</p>
</div>
<script>
(function(){
  var FEED=${JSON.stringify(feed)};
  /* Download goes to the app's own file route, which saves the MP4 itself. */
  var FILE=${JSON.stringify(input.videoId ? `${input.origin}/api/video/${input.videoId}/file` : "")};
  var $=function(id){return document.getElementById(id)};
  var state=null,scenes=[],i=0,playing=false,t0=0,elapsedBefore=0,timer=null,lastKey='';
  /* On a phone, Download saves the MP4 to Photos through the share sheet,
     which opens only straight from a tap — so the first tap fetches it and
     the second shares it. A link opened in a new tab inherited this frame's
     sandbox there and saved nothing. A computer keeps the link. */
  var phone=/iphone|ipad|ipod|android/i.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&/macintosh/i.test(navigator.userAgent));
  /* One saver for every download link: the cut and each ready-to-post
     version. data-src is the file itself (a signed link); the href is the
     app's own download for a computer. */
  var saved={};
  function base(){return(($('title').textContent||'video').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'video')}
  function share(f){
    var ok=false;try{ok=typeof navigator.share==='function'&&navigator.canShare&&navigator.canShare({files:[f]})}catch(x){}
    if(ok){navigator.share({files:[f],title:f.name}).catch(function(){});return}
    var u=URL.createObjectURL(f),a=document.createElement('a');a.href=u;a.download=f.name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u)},60000);
  }
  if(phone)document.addEventListener('click',function(e){
    var dl=e.target&&e.target.closest&&e.target.closest('a.dl');if(!dl)return;
    var src=dl.getAttribute('data-src')||(state&&state.final);if(!src)return;
    e.preventDefault();
    var label=dl.getAttribute('data-label')||dl.textContent,name=base()+(dl.getAttribute('data-kind')?'-'+dl.getAttribute('data-kind'):'')+'.mp4';
    var s=saved[src]||(saved[src]={file:null,loading:null});
    if(s.file){share(s.file);return}
    if(s.loading)return;
    dl.setAttribute('data-label',label);dl.textContent='Preparing\u2026';
    s.loading=fetch(src).then(function(r){if(!r.ok)throw new Error(r.status);return r.blob()}).then(function(b){s.file=new File([b],name,{type:b.type||'video/mp4'});dl.textContent='Save to Photos'}).catch(function(){s.loading=null;dl.textContent=label;window.open(dl.href,'_blank')});
  });
  var RATIO={'9:16':'9 / 16','1:1':'1 / 1','16:9':'16 / 9','4:5':'4 / 5'};
  function media(n,engine){var r=(state.renders||[]).find(function(x){return x.scene===n&&x.engine===engine&&x.status==='done'&&x.url});return r?r.url:null}
  function job(n){var rs=(state.renders||[]).filter(function(x){return x.scene===n&&(x.engine==='video'||x.engine==='avatar')});if(!rs.length)return'';if(rs.some(function(x){return x.status==='done'}))return'done';if(rs.some(function(x){return x.status==='failed'}))return'fail';return'run'}
  function total(){return scenes.reduce(function(a,s){return a+(s.duration||3)},0)}
  function show(k){
    i=k;var s=scenes[k];if(!s)return;
    document.querySelectorAll('.scene').forEach(function(el,j){el.classList.toggle('on',j===k)});
    var clip=media(s.n,'avatar')||media(s.n,'video'),v=$('clip'),card=$('card');
    /* Words over the picture only when there is a picture: over the waiting
       card they collide with it. */
    $('ost').textContent=clip?(s.onScreenText||''):'';
    $('cap').hidden=!(clip&&s.voiceover);$('cap').textContent=s.voiceover||'';
    if(clip){card.style.display='none';if(v.getAttribute('src')!==clip)v.src=clip;v.currentTime=0;if(playing)v.play().catch(function(){})}
    else{
      /* What a person waiting wants: which scene, and what it will say —
         never the prompt the engine was given, never a red error. */
      v.removeAttribute('src');v.load();card.style.display='flex';var j=job(s.n);
      card.classList.toggle('busy',j==='run'||state.video.status==='rendering'&&j!=='fail');
      card.querySelector('b').textContent=j==='fail'?'Scene '+s.n+' isn\u2019t ready':j==='run'||state.video.status==='rendering'?'Filming scene '+s.n+' of '+scenes.length+'\u2026':'Scene '+s.n;
      var line=s.voiceover||s.onScreenText||'';card.querySelector('span').textContent=line?'\u201c'+line+'\u201d':''}
    var a=$('voice'),vo=media(s.n,'voice');if(vo){if(a.getAttribute('src')!==vo)a.src=vo;a.currentTime=0;if(playing)a.play().catch(function(){})}else{a.pause();a.removeAttribute('src')}
  }
  function startedAt(k){var x=0;for(var j=0;j<k;j++)x+=scenes[j].duration||3;return x}
  function tick(){
    if(!playing)return;var s=scenes[i];var spent=(performance.now()-t0)/1000;
    var at=startedAt(i)+spent;$('prog').style.width=Math.min(100,at/Math.max(1,total())*100)+'%';$('time').textContent=Math.floor(at)+'s / '+total()+'s';
    if(spent>=(s.duration||3)){if(i+1<scenes.length){t0=performance.now();show(i+1)}else{stop();show(0);$('prog').style.width='0'}}
    timer=requestAnimationFrame(tick);
  }
  function play(){playing=true;$('play').textContent='❚❚';t0=performance.now();show(i);timer=requestAnimationFrame(tick)}
  function stop(){playing=false;$('play').textContent='▶';cancelAnimationFrame(timer);$('clip').pause();$('voice').pause()}
  $('play').addEventListener('click',function(){playing?stop():play()});
  function render(){
    var latest=state.latest;if(!latest){$('status').textContent='Writing your script\u2026';$('empty').hidden=false;return}
    $('empty').hidden=true;var plan=latest.plan;scenes=plan.scenes||[];$('title').textContent=plan.title||$('title').textContent;
    var st=state.video.status,n=scenes.length,done=scenes.filter(function(s){return job(s.n)==='done'}).length,failed=scenes.filter(function(s){return job(s.n)==='fail'}).length;
    var filming=!state.final&&(st==='rendering'||scenes.some(function(s){return job(s.n)==='run'}));
    $('status').textContent=state.final?'Your video is ready.'
      :filming?'Filming your video \u2014 '+done+' of '+n+' scenes ready'
      :failed&&!done?'We couldn\u2019t film this video just now.'
      :failed?done+' of '+n+' scenes are ready.'
      :done?'Your scenes are ready \u2014 press play.'
      :'Your script is ready.';
    var note=filming?'This usually takes 10\u201320 minutes. You can leave this page \u2014 the finished video will be in the chat.'
      :failed&&!done?'You haven\u2019t been charged for the scenes. Ask in the chat to try again in a little while.'
      :failed?(failed===1?'One scene':failed+' scenes')+' couldn\u2019t be made \u2014 ask in the chat to try '+(failed===1?'it':'them')+' again.':'';
    $('note').textContent=note;$('note').hidden=!note;
    $('progwrap').hidden=!filming;$('progall').style.width=Math.max(6,n?done/n*100:0)+'%';
    $('bar').style.display=done||state.final?'':'none';
    if(state.final){$('final').hidden=false;$('player').hidden=true;if($('finalv').getAttribute('src')!==state.final){$('finalv').src=state.final;$('finaldl').href=FILE?FILE+'?v='+latest.version+'&download=1':state.final}
      var ex=(state.exports||[]).map(function(x){return'<a class="dl" target="_blank" rel="noopener" data-kind="'+x.kind+'" data-src="'+String(x.url).replace(/"/g,'&quot;')+'" href="'+(FILE?FILE+'?v='+latest.version+'&download=1&format='+x.kind:x.url).replace(/"/g,'&quot;')+'">'+String(x.label).replace(/[<>&]/g,'')+'</a>'}).join('');
      if($('exports').getAttribute('data-k')!==ex){$('exports').innerHTML=ex;$('exports').setAttribute('data-k',ex)}}
    else{$('final').hidden=true;$('player').hidden=false;var ratio=RATIO[plan.aspect]||'9 / 16',p=ratio.split(' / ');$('stage').style.aspectRatio=ratio;
      /* As large as fits: the full width, or the height of the screen less the controls — whichever is smaller. */
      $('stage').style.width='min(100%, calc((100vh - 170px) * '+p[0]+' / '+p[1]+'))';$('bar').style.width=$('stage').style.width}
    var key=JSON.stringify((state.renders||[]).map(function(r){return[r.scene,r.engine,r.status]}))+latest.version+st;
    if(key!==lastKey){lastKey=key;$('sh').hidden=false;
      $('scenes').innerHTML=scenes.map(function(s,k){var j=job(s.n),c=media(s.n,'avatar')||media(s.n,'video');var tag=j==='done'?'Ready':j==='run'?'Filming\u2026':j==='fail'?'Not made':'';return'<div class="scene" data-k="'+k+'"><span class="dot '+(j==='done'?'done':j==='run'?'run':j==='fail'?'fail':'')+'"></span><p>'+(s.n)+'. '+String(s.voiceover||s.onScreenText||'Scene '+s.n).replace(/[<>&]/g,'')+'</p>'+(tag?'<span class="tag">'+tag+'</span>':'')+'</div>'}).join('');
      document.querySelectorAll('.scene').forEach(function(el){el.addEventListener('click',function(e){if(e.target.tagName==='A')return;stop();show(+el.dataset.k)})});
      if(!playing)show(i<scenes.length?i:0);
    }
  }
  function load(){
    if(!FEED){$('status').textContent='';$('empty').hidden=false;return}
    fetch(FEED,{cache:'no-store'}).then(function(r){return r.json()}).then(function(s){if(!s||!s.video)throw 0;state=s;render();
      var busy=s.video.status==='rendering'||s.video.status==='planning'||(s.renders||[]).some(function(r){return r.status==='running'||r.status==='queued'});
      setTimeout(load,busy?6000:30000)}).catch(function(){$('status').textContent='Could not load the video just now — retrying…';setTimeout(load,10000)});
  }
  load();
})();
</script></body></html>`;
}
