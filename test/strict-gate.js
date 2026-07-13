'use strict';
// STRICT_BOARDS gate: with the flag on, a provisioned board missing from the listing fails the
// run instead of soft-skipping; with it off, legacy skip behavior is unchanged. Runs validate.js
// as a child process with a stubbed global fetch (listing endpoint only) and state files pointed
// at a temp dir -- no network, no side effects on real state.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-gate-'));
const stub = path.join(dir, 'stub.js');
fs.writeFileSync(stub, [
  "const LIST = JSON.parse(process.env.STUB_BOARDS || '[]');",
  'global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ response: { leaderboards: LIST } }) });',
].join('\n'));

function run(extraEnv) {
  const env = Object.assign({}, process.env, {
    STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'r', LP_LB: 'p', STATE_SALT: 's',
    PROCESSED_FILE: path.join(dir, 'processed.json'), SKILL_FILE: path.join(dir, 'skill.json'),
    LEAVERS_FILE: path.join(dir, 'leavers.json'), STARTS_FILE: path.join(dir, 'starts.json'),
    SIGNALS_FILE: path.join(dir, 'signals.json'), XP_FILE: path.join(dir, 'xp.json'),
  }, extraEnv);
  const r = spawnSync(process.execPath, ['-r', stub, path.join(__dirname, '..', 'validate.js')], { env, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

let n = 0;
function ok(cond, msg) { n++; if (!cond) { console.error('FAIL ' + msg); process.exit(1); } console.log('ok ' + n + ' ' + msg); }

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
