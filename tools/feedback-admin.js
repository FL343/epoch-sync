'use strict';
// ============================================================
// feedback-admin -- local moderation console (PLAYER_VOICE_PLAN §5)
// ============================================================
// Local-only HTML console over the repo checkout: pulls first, shows the item
// set (held / recent / filtered / all) with votes and report counts, writes
// moderation actions into feedback-mod.json, and publishes with one button
// (commit + pull --rebase + push; the next cron tick applies it). Review
// semantics mirror the pipeline: block is declarative, 'allow' releases a
// filtered false positive, 'clear' stamps a clearance time so a held item
// returns and prior reports stop counting.
//
// Emergency lane ("nuke"): block + delete the item's feed entries via the
// Steam Web API RIGHT NOW instead of waiting a tick. Publisher key is read
// from ~/gmt-secrets at call time and never stored anywhere.
//
// Run: node tools/feedback-admin.js   (then open http://127.0.0.1:8399)
//   --no-pull        skip the startup git pull (offline / e2e)
//   PORT / FB_STATE_FILE / FB_MOD_FILE / APPID env overrides for e2e.
// Terminal output stays text-free (counts only); player text renders in the
// browser page only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const cp = require('child_process');

const REPO = path.join(__dirname, '..');
const fb = require('../feedback.js');
const STATE = process.env.FB_STATE_FILE ? path.resolve(process.env.FB_STATE_FILE) : path.join(REPO, 'feedback.json');
const MOD = process.env.FB_MOD_FILE ? path.resolve(process.env.FB_MOD_FILE) : path.join(REPO, 'feedback-mod.json');
const PORT = Number(process.env.PORT || 8399);
const APPID = process.env.APPID || '4815320';

function git(args) {
  const r = cp.spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}
function loadJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } }
function loadModFile() {
  const m = loadJson(MOD, {});
  return { block: (m.block || []).map(n => n | 0), allow: (m.allow || []).map(n => n | 0), clear: m.clear || {} };
}
function saveModFile(m) { fs.writeFileSync(MOD, JSON.stringify(m, null, 1) + '\n'); }

function dataPayload() {
  const st = loadJson(STATE, { items: {}, votes: {}, boards: {} });
  const mod = loadModFile();
  const nowMin = fb.nowTsMin();
  const items = Object.keys(st.items || {}).map(id => {
    const it = st.items[id];
    const t = fb.tallyVotes((st.votes || {})[id], it.ap);
    const clearAt = (mod.clear[id] != null) ? (mod.clear[id] | 0) : -1;
    return {
      id, cat: fb.FB_CATS[it.cat | 0] || String(it.cat), lang: it.lang, ts: it.ts | 0,
      ageMin: Math.max(0, nowMin - (it.ts | 0)), st: it.st, ha: it.ha | 0,
      up: t.up, down: t.down, rep: fb.reportsSince((st.votes || {})[id], it.ap, clearAt),
      repAll: t.rep, text: it.text,
    };
  }).sort((a, b) => b.ts - a.ts);
  return { nowMin, holdAt: fb.FB_REPORT_HOLD, items, mod };
}

// Emergency: block + delete this item's entries from every feed board now.
async function nuke(id) {
  let key = process.env.STEAM_PUBLISHER_KEY;
  if (!key) {
    key = fs.readFileSync(path.join(os.homedir(), 'gmt-secrets', 'steam_publisher_key.txt'), 'utf8').trim();
  }
  process.env.STEAM_PUBLISHER_KEY = key;
  process.env.APPID = APPID;
  const v = require('../validate.js');
  const mod = loadModFile();
  if (mod.block.indexOf(id | 0) < 0) { mod.block.push(id | 0); saveModFile(mod); }
  const st = loadJson(STATE, { boards: {} });
  let removed = 0, boards = 0;
  for (const name of Object.keys(st.boards || {})) {
    if (name.indexOf('_hot') < 0 && name.indexOf('_new') < 0) continue;
    boards++;
    const br = await v.readBoardAll(st.boards[name], name);
    for (const e of br.ents) {
      const d = v.decodeDetails(e.detailData);
      if ((d[3] | 0) !== (id | 0)) continue;
      const r = await v.postForm('/ISteamLeaderboards/DeleteLeaderboardScore/v1/', {
        key, appid: APPID, leaderboardid: st.boards[name], steamid: String(e.steamID), format: 'json',
      });
      if (r.ok) removed++;
    }
  }
  return { boards, removed };
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>feedback-admin</title>
<style>
body{background:#14100a;color:#e8e0d0;font:14px/1.5 system-ui,sans-serif;margin:0;padding:16px 20px}
h1{font-size:18px;color:#fbbf24}
.tabs button,.pub{background:#241c12;color:#e8e0d0;border:1px solid #4a3a20;border-radius:8px;padding:6px 14px;margin-right:6px;cursor:pointer}
.tabs button.on{border-color:#fbbf24;color:#fbbf24}
.pub{border-color:#4ecdc4;color:#4ecdc4;float:right}
.card{background:#1c1610;border:1px solid #3a2c18;border-radius:10px;padding:10px 14px;margin:10px 0}
.card.held{border-color:#ff9040}.card.blocked{border-color:#ff4040}.card.filtered{border-color:#8a7a5a}
.meta{font-size:12px;color:#a89878;margin-bottom:6px}
.meta b{color:#fbbf24}.meta .st{padding:1px 8px;border-radius:99px;border:1px solid #6a5a3a;margin-left:6px}
.txt{white-space:pre-wrap;word-break:break-word}
.act{margin-top:8px}.act button{background:#241c12;color:#e8e0d0;border:1px solid #5a4a2a;border-radius:6px;padding:3px 10px;margin-right:6px;cursor:pointer;font-size:12px}
.act button.warn{border-color:#ff9040;color:#ff9040}.act button.danger{border-color:#ff4040;color:#ff4040}
#log{font-size:12px;color:#7ac0b8;white-space:pre-wrap;margin-top:8px}
.empty{color:#7a6a4a;padding:24px;text-align:center}
</style>
<h1>玩家心声 · 管理台 <button class="pub" onclick="pub()">发布 (commit + push)</button></h1>
<div class="tabs" id="tabs"></div><div id="log"></div><div id="list"></div>
<script>
let DATA=null, VIEW='held';
const VIEWS={held:'待复核 (held)',fresh:'近 48h',filtered:'已过滤',blocked:'已下架',all:'全部'};
async function load(){DATA=await (await fetch('/data')).json();render();}
function rel(m){return m<60?m+'m':m<2880?Math.floor(m/60)+'h':Math.floor(m/1440)+'d';}
function render(){
  const tabs=document.getElementById('tabs');
  tabs.innerHTML=Object.keys(VIEWS).map(v=>'<button class="'+(v===VIEW?'on':'')+'" onclick="VIEW=\\''+v+'\\';render()">'+VIEWS[v]+' ('+count(v)+')</button>').join('');
  const list=document.getElementById('list');
  const items=DATA.items.filter(x=>match(x,VIEW));
  list.innerHTML=items.length?items.map(card).join(''):'<div class="empty">这个视图没有条目</div>';
}
function count(v){return DATA.items.filter(x=>match(x,v)).length;}
function match(x,v){
  if(v==='held')return x.st==='held';
  if(v==='fresh')return x.ageMin<2880;
  if(v==='filtered')return x.st==='filtered'||x.st==='capped';
  if(v==='blocked')return x.st==='blocked';
  return true;
}
function esc(s){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function card(x){
  const acts=[];
  if(x.st!=='blocked')acts.push('<button class="warn" onclick="act(\\'block\\','+x.id+')">下架</button>');
  else acts.push('<button onclick="act(\\'unblock\\','+x.id+')">解除下架</button>');
  if(x.st==='filtered'||x.st==='capped')acts.push('<button onclick="act(\\'allow\\','+x.id+')">放行</button>');
  if(x.st==='held')acts.push('<button onclick="act(\\'clear\\','+x.id+')">恢复 (清举报计数)</button>');
  acts.push('<button class="danger" onclick="if(confirm(\\'立即从全部展示榜删除并下架？\\'))act(\\'nuke\\','+x.id+')">紧急撤榜</button>');
  return '<div class="card '+x.st+'"><div class="meta"><b>['+x.cat+'/'+x.lang+']</b> '+rel(x.ageMin)+' 前'+
    ' · ▲'+x.up+' ▼'+x.down+' · 举报 '+x.rep+'/'+DATA.holdAt+(x.repAll!==x.rep?' (累计 '+x.repAll+')':'')+
    ' · id='+x.id+'<span class="st">'+x.st+'</span></div>'+
    '<div class="txt">'+esc(x.text)+'</div><div class="act">'+acts.join('')+'</div></div>';
}
async function act(a,id){
  const r=await (await fetch('/act?a='+a+'&id='+id,{method:'POST'})).json();
  document.getElementById('log').textContent=r.msg||JSON.stringify(r);
  await load();
}
async function pub(){
  document.getElementById('log').textContent='publishing...';
  const r=await (await fetch('/publish',{method:'POST'})).json();
  document.getElementById('log').textContent=r.msg;
}
load();
</script>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' }); res.end(body); };
  try {
    if (u.pathname === '/') return send(200, PAGE, 'text/html; charset=utf-8');
    if (u.pathname === '/data') return send(200, JSON.stringify(dataPayload()));
    if (u.pathname === '/act' && req.method === 'POST') {
      const a = u.searchParams.get('a'), id = u.searchParams.get('id') | 0;
      const mod = loadModFile();
      if (a === 'block') { if (mod.block.indexOf(id) < 0) mod.block.push(id); }
      else if (a === 'unblock') { mod.block = mod.block.filter(n => n !== id); }
      else if (a === 'allow') { if (mod.allow.indexOf(id) < 0) mod.allow.push(id); }
      else if (a === 'clear') { mod.clear[String(id)] = fb.nowTsMin(); }
      else if (a === 'nuke') {
        const r = await nuke(id);
        return send(200, JSON.stringify({ ok: true, msg: '紧急撤榜完成: 扫 ' + r.boards + ' 榜, 删 ' + r.removed + ' 条 (已加入 block; 记得点发布固化)' }));
      } else return send(400, JSON.stringify({ ok: false, msg: 'bad action' }));
      saveModFile(mod);
      return send(200, JSON.stringify({ ok: true, msg: a + ' id=' + id + ' 已写入 feedback-mod.json (点发布后下一 tick 生效)' }));
    }
    if (u.pathname === '/publish' && req.method === 'POST') {
      const steps = [];
      let r = git(['add', '--', path.basename(MOD)]);
      steps.push('add: ' + (r.ok ? 'ok' : r.out));
      r = git(['diff', '--cached', '--quiet']);
      if (r.ok) return send(200, JSON.stringify({ ok: true, msg: '没有要发布的改动' }));
      r = git(['commit', '-m', 'mod: update feedback moderation file']);
      steps.push('commit: ' + (r.ok ? 'ok' : r.out));
      r = git(['pull', '--rebase']);
      steps.push('pull: ' + (r.ok ? 'ok' : r.out));
      r = git(['push']);
      steps.push('push: ' + (r.ok ? 'ok (下一 tick 生效)' : r.out));
      return send(200, JSON.stringify({ ok: r.ok, msg: steps.join('\n') }));
    }
    send(404, JSON.stringify({ ok: false, msg: 'not found' }));
  } catch (e) {
    send(500, JSON.stringify({ ok: false, msg: String(e && e.message) }));
  }
});

if (process.argv.indexOf('--no-pull') < 0) {
  const r = git(['pull', '--rebase']);
  console.log('git pull: ' + (r.ok ? 'ok' : 'FAILED (offline?)'));
}
server.listen(PORT, '127.0.0.1', () => {
  const n = Object.keys(loadJson(STATE, { items: {} }).items || {}).length;
  console.log('feedback-admin: http://127.0.0.1:' + PORT + '  (items: ' + n + ')');
});
