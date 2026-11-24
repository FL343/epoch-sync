#!/usr/bin/env node
'use strict';
// ============================================================
// tools/fallback-guard.js -- do not settle on top of fallback state that was never handed back (O1018, 2026-11-24)
// ============================================================
// Why: during an outage a fallback tier settles from its own copy of the state -- tier 2 (GitLab epoch-ops, branch
//   `fallback-state` on the mirror) or tier 3 (the Cloud Run failover service, bucket state/fallback/latest.json). The points / XP /
//   CP boards are written as the board value + the change (validate.js reads the boards as each run's base); what keeps a
//   match from being applied twice is only processed.json. When the outage ends and nobody hands the fallback's state
//   back (the monitor clears its flag on the first successful run -- the gated probe runs count), this branch still has
//   the old processed.json, and its next run settles the same matches again on top of the boards the fallback already
//   wrote: a loss is taken twice, a win and the XP / CP paid twice (the persist step's own note says the same about a
//   lost state commit). 11-11 was the last real takeover (0 fresh matches, nothing doubled); after the 11-17 launch the
//   next one would double every match it settled.
// What it checks (validate.yml step `fallback guard`, after the tests, before the run): the time of this branch's last
//   commit touching the reconcile state files (validate.yml's persist list) against
//     - the mirror's `fallback-state` branch tip (commit time), and
//     - the Cloud Run status page's `fallback` summary (GET <VAULT_URL>/status -> fallback { ts, handedBack }).
//   A fallback NEWER than this branch's last state commit = this branch has not settled since it was written = not handed
//   back -> ::error:: and exit 1: the run step and the persist step are skipped, nothing settles, nothing persists. The job
//   fails, so the monitor sees no success and calls the fallback tiers again, which carry on from their own state (no
//   double, only slower: every 30 min) and mail -- "stop and wait for a person" (user ruling 2026-11-24). A handback
//   (tier 2 rebases its commits onto this branch, tier 3 commits the state) makes this branch's last state commit newer,
//   and the guard lets the next run through.
//   OLDER = a leftover of an earlier incident (this branch settled after it): ::warning:: only (the weekly tier-3 drill
//   names it too, O1016). UNREADABLE (mirror / status page down, secrets unset) = ::warning:: and proceed: blocking on an
//   unreachable mirror would stop the settlement whenever GitLab hiccups (the gate step is fail-open for the same reason).
// Usage: node tools/fallback-guard.js     env: MIRROR_URL MIRROR_SSH_KEY MIRROR_KNOWN_HOSTS VAULT_URL  (exit 0 = settle, 1 = do not)
// Pinned by test/fallback-guard.js.
// ============================================================
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const BRANCH = 'fallback-state';
const iso = (t) => (Number.isFinite(t) && t > 0) ? new Date(t).toISOString() : '?';

// the reconcile state files = validate.yml's persist loop (`for f in a.json b.json; do` + `[ -f "$f" ]`), the same read as
//   tools/code-hash.js and the tier-3 service (settle.js stateFilesFromWorkflow)
function stateFilesOf(yaml) {
  const out = [];
  for (const m of String(yaml).matchAll(/for f in ([^;\n]+); do\s*\n\s*\[ -f "\$f" \]/g)) for (const n of m[1].trim().split(/\s+/)) if (!out.includes(n)) out.push(n);
  return out;
}

// pure verdict. mainTs: ms of this branch's last state commit (null = unknown). gl: { sha, ts } | null (no branch) | { error }.
//   vault: the status page's fallback summary { ts, handedBack, head } | null (none) | { error }.
//   -> { block, current: [..], leftovers: [..], unreadable: [..] }
function decide({ mainTs, gl, vault }) {
  const out = { block: false, current: [], leftovers: [], unreadable: [] };
  const known = Number.isFinite(mainTs) && mainTs > 0;
  if (!known) out.unreadable.push('this branch has no commit touching the state files (no baseline)');
  const judge = (name, ts, label) => {
    if (!Number.isFinite(ts) || ts <= 0) { out.unreadable.push(name + ': no usable time'); return; }
    if (!known) return;
    (ts > mainTs ? out.current : out.leftovers).push(label + ' (' + iso(ts) + (ts > mainTs ? ', newer than' : ', older than') + ' this branch\'s last state commit ' + iso(mainTs) + ')');
  };
  if (gl && gl.error) out.unreadable.push('mirror ' + BRANCH + ': ' + gl.error);
  else if (gl) judge('mirror ' + BRANCH, gl.ts, 'mirror ' + BRANCH + ' @' + String(gl.sha || '?').slice(0, 12));
  if (vault && vault.error) out.unreadable.push('tier-3 status: ' + vault.error);
  else if (vault && !vault.handedBack) judge('tier-3 bucket fallback', Number(vault.ts), 'tier-3 bucket fallback' + (vault.head ? ' head ' + String(vault.head).slice(0, 12) : ''));
  out.block = out.current.length > 0;
  return out;
}

// ---- I/O (each source on its own: a failure is "unreadable", never a throw) ----
function sh(args, opt) {
  const r = cp.spawnSync('git', args, Object.assign({ cwd: ROOT, encoding: 'utf8', timeout: 60000 }, opt || {}));
  // err on one line: it goes into a ::warning:: annotation, which ends at the first newline
  return { ok: r.status === 0, out: String(r.stdout || '').trim(), err: String(r.stderr || r.error || '').replace(/\s+/g, ' ').trim().slice(0, 200) };
}
function mainStateTs(files) {
  if (!files.length) return null;
  const r = sh(['log', '-1', '--format=%ct', '--', ...files]);
  const s = Number(r.out) * 1000;
  return r.ok && s > 0 ? s : null;
}
function sshEnv() {
  const key = process.env.MIRROR_SSH_KEY, kh = process.env.MIRROR_KNOWN_HOSTS;
  const env = Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' });
  if (!key) return env;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbguard-'));
  const kf = path.join(dir, 'key'), hf = path.join(dir, 'known_hosts');
  fs.writeFileSync(kf, String(key).replace(/\r/g, '').trimEnd() + '\n', { mode: 0o600 });
  fs.writeFileSync(hf, String(kh || '').replace(/\r/g, '').trimEnd() + '\n');
  env.GIT_SSH_COMMAND = 'ssh -i ' + kf + ' -o IdentitiesOnly=yes -o UserKnownHostsFile=' + hf + ' -o StrictHostKeyChecking=yes -o ConnectTimeout=20';
  return env;
}
function mirrorFallback(url) {
  if (!url) return { error: 'MIRROR_URL unset' };
  const env = sshEnv();
  const ls = sh(['ls-remote', '--heads', url, BRANCH], { env, timeout: 30000 });
  if (!ls.ok) return { error: 'ls-remote failed: ' + ls.err };
  const sha = (ls.out.split(/\s+/)[0] || '').trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) return null;   // no such branch = nothing pending on tier 2
  // the branch grows from this branch's history (tier 2 branches off the mirror's main), so a fetch brings only its own commits
  const ref = 'refs/fallback-guard/' + BRANCH;
  const f = sh(['fetch', '--quiet', '--no-tags', url, '+refs/heads/' + BRANCH + ':' + ref], { env, timeout: 90000 });
  if (!f.ok) return { error: 'fetch failed: ' + f.err, sha };
  const t = sh(['log', '-1', '--format=%ct', ref]);
  sh(['update-ref', '-d', ref]);
  const ts = Number(t.out) * 1000;
  return t.ok && ts > 0 ? { sha, ts } : { error: 'commit time unreadable', sha };
}
async function vaultFallback(url) {
  if (!url) return { error: 'VAULT_URL unset' };
  try {
    const r = await fetch(String(url).replace(/\/$/, '') + '/status', { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { error: 'status HTTP ' + r.status };
    const j = await r.json();
    if (!j || typeof j !== 'object' || !('fallback' in j)) return { error: 'status page has no fallback field (service older than O1018 segment A)' };
    return j.fallback;   // null = none, { error } = the service could not read its bucket
  } catch (e) { return { error: 'status unreachable: ' + (e && e.message) }; }
}

async function main() {
  const yaml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'validate.yml'), 'utf8');
  const files = stateFilesOf(yaml);
  const mainTs = mainStateTs(files);
  const [gl, vault] = await Promise.all([Promise.resolve().then(() => mirrorFallback(process.env.MIRROR_URL)), vaultFallback(process.env.VAULT_URL)]);
  const v = decide({ mainTs, gl, vault });
  for (const u of v.unreadable) console.log('::warning::fallback guard: ' + u + ' -- not checked, settling as usual (fail-open, like the gate)');
  for (const l of v.leftovers) console.log('::warning::fallback guard: leftover from an earlier incident, this branch settled after it: ' + l + ' -- check it, then delete it (failover runbook: "leftover fallback")');
  if (v.block) {
    console.log('::error::fallback guard: fallback state that was never handed back: ' + v.current.join('; ') + ' -- this run does not settle (settling would apply those matches\' points / XP / CP a second time). Hand it back: the fallback tiers do it once GitHub is healthy (GitLab epoch-ops fallback job / Cloud Run /settle), or by hand (failover runbook: "handback"). O1018');
    return 1;
  }
  console.log('fallback guard: nothing pending (this branch\'s last state commit ' + iso(mainTs) + '; mirror ' + (gl && !gl.error ? '@' + String(gl.sha).slice(0, 12) + ' ' + iso(gl.ts) : (gl ? 'unreadable' : 'no ' + BRANCH)) + '; tier 3 ' + (vault && !vault.error ? (vault.handedBack ? 'handed back' : iso(Number(vault.ts))) : (vault ? 'unreadable' : 'none')) + ')');
  return 0;
}

module.exports = { decide, stateFilesOf, BRANCH };
if (require.main === module) main().then((c) => process.exit(c), (e) => { console.log('::warning::fallback guard crashed: ' + (e && e.message) + ' -- settling as usual (fail-open)'); process.exit(0); });
