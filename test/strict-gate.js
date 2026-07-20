'use strict';
// STRICT_BOARDS gate: with the flag on, a provisioned board missing from the listing fails the
// run instead of soft-skipping; with it off, legacy skip behavior is unchanged. Runs validate.js
// as a child process with a stubbed global fetch (listing endpoint only) and state files pointed
// at a temp dir -- no network, no side effects on real state.
//
// State isolation is structural, not a hand-kept list: every *_FILE env var is scanned from the
// validate.js source and redirected, and the child runs with cwd inside the temp dir so relative
// defaults can never resolve to the repo checkout. A hand-kept list once missed CONFESSIONS_FILE:
// the first real pending confession in the repo's committed state made the confession-path board
// gate trip ahead of the report gate, turning this test red and stalling the production cron.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-gate-'));
const stub = path.join(dir, 'stub.js');
fs.writeFileSync(stub, [
  "const LIST = JSON.parse(process.env.STUB_BOARDS || '[]');",
  'global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ response: { leaderboards: LIST } }) });',
].join('\n'));

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const FILE_VARS = Array.from(new Set(
  Array.from(fs.readFileSync(VALIDATE, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])
));

function run(extraEnv) {
  const stateEnv = {};
  for (const v of FILE_VARS) stateEnv[v] = path.join(dir, v.toLowerCase() + '.json');
  const env = Object.assign({}, process.env, {
    STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'r', LP_LB: 'p', STATE_SALT: 's',
  }, stateEnv, extraEnv);
  const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env, encoding: 'utf8', cwd: dir });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

let n = 0;
function ok(cond, msg) { n++; if (!cond) { console.error('FAIL ' + msg); process.exit(1); } console.log('ok ' + n + ' ' + msg); }

// Tripwire: the scan must keep seeing at least the eight state files known today; a refactor
// that breaks the pattern would silently degrade isolation back to cwd-only.
ok(FILE_VARS.length >= 8, 'state-file scan found ' + FILE_VARS.length + ' *_FILE vars (>= 8)');

// 1) strict on, report board absent -> hard fail (trips before any state write)
let r = run({ STRICT_BOARDS: '1', STUB_BOARDS: '[]' });
ok(r.code === 1, 'strict: missing report board exits 1 (got ' + r.code + ')');
ok(r.out.indexOf('::error::report board absent') >= 0, 'strict: report gate message emitted');

// 2) strict on, report board present but trust board absent -> trust gate trips
r = run({ STRICT_BOARDS: '1', STUB_BOARDS: JSON.stringify([{ name: 'report_box', id: 9, entries: 0 }]) });
ok(r.code === 1, 'strict: missing trust board exits 1 (got ' + r.code + ')');
ok(r.out.indexOf('::error::trust board absent') >= 0, 'strict: trust gate message emitted');

// 3) flag off (default) -> legacy soft skip, clean exit, no errors
r = run({ STUB_BOARDS: '[]' });
ok(r.code === 0, 'default: soft skip exits 0 (got ' + r.code + ')');
ok(r.out.indexOf('report board absent') >= 0, 'default: skip is still logged');
ok(r.out.indexOf('::error::') < 0, 'default: no error annotation');

console.log('strict-gate: all ' + n + ' assertions passed');
