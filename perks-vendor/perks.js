// generated file: comments stripped from the client-side source; regenerate with the companion repo's scripts/gen-perks-vendor.js (byte-locked there)
window.PERKS = (() => {
  const FALLBACK = { SLOTS: 3, MAX_DRAWS: 20, DRAW_EVERY: 5, GATE_EVERY: 10, PICK_TIMEOUT_S: 20, PITY_EVERY: 3,
    CONTRACT_MAX: 2, CONTRACT_MIN_DRAW: 3, CONTRACT_P_MILLI: 350, TIME_ADD_MIN: -30, VALUE_MUL_CAP: 1.6, CLASS_MUL_CAP: 25, TABLE_VER: 1 };
  function cfg() {
    const R = window.RANKED_CONFIG;
    return (R && R.ENDLESS && R.ENDLESS.PERKS) || FALLBACK;
  }
  function cfgNum(key) { const v = cfg()[key]; return (typeof v === 'number') ? v : FALLBACK[key]; }
  const PERK_SALT = 0x9E4B;
  const SEASON_SALT = 0x5EA5;
  const CLS_KEYS = ['gold', 'rock', 'bone', 'gem', 'cursed', 'creature', 'other'];
  const CLS = {}; CLS_KEYS.forEach((k, i) => { CLS[k] = i; });
  const ITEM_CLS = {
    goldSmall: 'gold', goldMid: 'gold', goldLarge: 'gold', goldHuge: 'gold',
    rockSmall: 'rock', rockLarge: 'rock',
    bone: 'bone', skull: 'bone', boneAncient: 'bone', skullAncient: 'bone',
    diamond: 'gem', gemTurquoise: 'gem', pearl: 'gem', opal: 'gem',
    cursedSkull: 'cursed',
    mysteryBag: 'other', doomBag: 'other', tntPickup: 'other', tntShard: 'other', freezeBox: 'other', slotCoin: 'other',
    chip: 'other', dice: 'other', idol: 'other',
    cobweb: 'other', vine: 'other', icicle: 'other', coral: 'other', plank: 'other',
  };
  function clsOfItem(key) { const c = ITEM_CLS[key]; return c == null ? CLS.other : CLS[c]; }
  function clsOfCreature() { return CLS.creature; }
  const T1_FIELDS = ['valueMul', 'clearBonusMul', 'levelTimeAdd', 'invGrant', 'strengthBonus', 'shopMul', 'flags',
    'cursedMul', 'combo', 'emptyReturn', 'midas', 'drill', 'shatterBonus'];
  const VALUE_MUL_KEYS = CLS_KEYS.concat(['all']);
  const INV_KEYS = ['tnt', 'freeze'];
  const FLAG_KEYS = ['clover'];
  const SUB_KEYS = { combo: ['every', 'mul'], emptyReturn: ['amt', 'cap'], midas: ['n', 'value'], drill: ['lv'] };
  const ONE_PER_TABLE = ['combo', 'emptyReturn', 'midas', 'drill'];
  const RENDER_ONLY = ['hookSpeedMul', 'pullSpeedMul', 'freezeDurMul', 'highlight', 'laser'];
  const AXES = ['time', 'value', 'speed', 'item', 'neg', 'economy', 'collect', 'life', 'info'];
  const RARITIES = ['common', 'rare', 'epic'];
  const SCOPES = ['self', 'team', 'world'];
  const RARITY_BY_BAND = [[100, 0, 0], [85, 13, 2], [75, 20, 5], [65, 27, 8]];
  const RARITY_GATE = [[0, 85, 15], [0, 80, 20], [0, 70, 30], [0, 60, 40]];
  const LIST = [
    { id: 1, key: 'timekeeper', axis: 'time', rarity: 'common', scope: 'team', modes: { solo: true, coop: true, duel: false }, rollable: true, icon: '⏱',
      lv: [{ levelTimeAdd: 10 }, { levelTimeAdd: 15 }, { levelTimeAdd: 20 }], p: [{ a: 10 }, { a: 15 }, { a: 20 }] },
    { id: 2, key: 'timeIsMoney', axis: 'time', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '💸',
      lv: [{ clearBonusMul: 2 }, { clearBonusMul: 3 }, { clearBonusMul: 4 }], p: [{ a: 2 }, { a: 3 }, { a: 4 }] },
    { id: 3, key: 'rockLover', axis: 'value', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '🪨',
      lv: [{ valueMul: { rock: 3, gold: 0.8 } }, { valueMul: { rock: 4, gold: 0.8 } }, { valueMul: { rock: 5, gold: 0.8 } }], p: [{ a: 3 }, { a: 4 }, { a: 5 }] },
    { id: 4, key: 'boneDealer', axis: 'value', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '💀',
      lv: [{ valueMul: { bone: 10, gem: 0.8 } }, { valueMul: { bone: 15, gem: 0.8 } }, { valueMul: { bone: 20, gem: 0.8 } }], p: [{ a: 10 }, { a: 15 }, { a: 20 }] },
    { id: 5, key: 'pyrotechnician', axis: 'item', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '🧨',
      lv: [{ invGrant: { tnt: 1 } }, { invGrant: { tnt: 2 } }, { invGrant: { tnt: 3 } }], p: [{ a: 1 }, { a: 2 }, { a: 3 }] },
    { id: 6, key: 'coldStorage', axis: 'item', rarity: 'common', scope: 'self', modes: { solo: false, coop: true, duel: true }, rollable: true, icon: '❄',
      lv: [{ invGrant: { freeze: 1 }, freezeDurMul: 1.5 }, { invGrant: { freeze: 1 }, freezeDurMul: 2 }, { invGrant: { freeze: 1 }, freezeDurMul: 2.5 }], p: [{ a: 1.5 }, { a: 2 }, { a: 2.5 }] },
    { id: 7, key: 'strengthTraining', axis: 'speed', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '💪',
      lv: [{ strengthBonus: 2, hookSpeedMul: 0.9 }, { strengthBonus: 3, hookSpeedMul: 0.9 }, { strengthBonus: 4, hookSpeedMul: 0.9 }], p: [{ a: 2 }, { a: 3 }, { a: 4 }] },
    { id: 8, key: 'quickHands', axis: 'speed', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '🚀',
      lv: [{ hookSpeedMul: 1.25, pullSpeedMul: 1.25 }, { hookSpeedMul: 1.35, pullSpeedMul: 1.35 }, { hookSpeedMul: 1.45, pullSpeedMul: 1.45 }], p: [{ a: 25 }, { a: 35 }, { a: 45 }] },
    { id: 9, key: 'eagleEye', axis: 'info', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '👁',
      lv: [{ highlight: 300 }, { highlight: 150 }, { highlight: 60 }], p: [{ a: 300 }, { a: 150 }, { a: 60 }] },
    { id: 10, key: 'cloverField', axis: 'neg', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '🍀',
      lv: [{ flags: { clover: true } }, { flags: { clover: true } }, { flags: { clover: true } }], p: [{}, {}, {}] },
    { id: 11, key: 'memberCard', axis: 'economy', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '🛒',
      lv: [{ shopMul: 0.8 }, { shopMul: 0.7 }, { shopMul: 0.6 }], p: [{ a: 80 }, { a: 70 }, { a: 60 }] },
    { id: 12, key: 'drillHook', axis: 'speed', rarity: 'epic', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '⛏',
      lv: [{ drill: { lv: 1 } }, { drill: { lv: 2 } }, { drill: { lv: 3 }, shatterBonus: 20 }], p: [{}, {}, { a: 20 }] },
    { id: 13, key: 'laserSight', axis: 'info', rarity: 'rare', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '🎯',
      lv: [{ laser: 1 }, { laser: 2 }, { laser: 3 }], p: [{}, {}, {}] },
    { id: 14, key: 'exorcist', axis: 'neg', rarity: 'rare', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '🔮',
      lv: [{ cursedMul: -0.5 }, { cursedMul: -0.75 }, { cursedMul: -1 }], p: [{ a: 50 }, { a: 75 }, { a: 100 }] },
    { id: 15, key: 'combo', axis: 'value', rarity: 'rare', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '🔗',
      lv: [{ combo: { every: 4, mul: 1.5 } }, { combo: { every: 4, mul: 1.75 } }, { combo: { every: 4, mul: 2 } }], p: [{ a: 1.5 }, { a: 1.75 }, { a: 2 }] },
    { id: 16, key: 'emptyComfort', axis: 'economy', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '🪙',
      lv: [{ emptyReturn: { amt: 25, cap: 8 } }, { emptyReturn: { amt: 50, cap: 8 } }, { emptyReturn: { amt: 75, cap: 8 } }], p: [{ a: 25, b: 8 }, { a: 50, b: 8 }, { a: 75, b: 8 }] },
    { id: 17, key: 'midas', axis: 'value', rarity: 'rare', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '✨',
      lv: [{ midas: { n: 1, value: 250 } }, { midas: { n: 2, value: 250 } }, { midas: { n: 3, value: 250 } }], p: [{ a: 1, b: 250 }, { a: 2, b: 250 }, { a: 3, b: 250 }] },
    { id: 18, key: 'greedPact', axis: 'value', rarity: 'epic', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, contract: true, icon: '📜',
      lv: [{ valueMul: { all: 1.2 }, levelTimeAdd: -8 }, { valueMul: { all: 1.35 }, levelTimeAdd: -12 }, { valueMul: { all: 1.5 }, levelTimeAdd: -16 }], p: [{ a: 1.2, b: 8 }, { a: 1.35, b: 12 }, { a: 1.5, b: 16 }] },
    { id: 19, key: 'glassCannon', axis: 'speed', rarity: 'epic', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, contract: true, icon: '⚡',
      lv: [{ hookSpeedMul: 1.4, pullSpeedMul: 1.4, cursedMul: 2 }, { hookSpeedMul: 1.5, pullSpeedMul: 1.5, cursedMul: 2.5 }, { hookSpeedMul: 1.6, pullSpeedMul: 1.6, cursedMul: 3 }], p: [{ a: 40, b: 2 }, { a: 50, b: 2.5 }, { a: 60, b: 3 }] },
    { id: 20, key: 'miserPact', axis: 'economy', rarity: 'epic', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, contract: true, icon: '💰',
      lv: [{ shopMul: 0.5, clearBonusMul: 0 }, { shopMul: 0.4, clearBonusMul: 0 }, { shopMul: 0.3, clearBonusMul: 0 }], p: [{ a: 50 }, { a: 40 }, { a: 30 }] },
  ];
  let TABLE = LIST;
  const BY_ID = new Map();
  function _index() { BY_ID.clear(); for (const p of TABLE) BY_ID.set(p.id | 0, p); }
  _index();
  function get(id) { return BY_ID.get(id | 0) || null; }
  function list() { return TABLE.slice(); }
  function validateTable(items) {
    const errs = [];
    const seen = new Set();
    const IT = items || window.ITEMS || null;
    for (const p of TABLE) {
      const id = p.id | 0;
      if (id < 1 || id > 127) errs.push('id out of range 1..127: ' + p.key + ' id=' + p.id);
      if (seen.has(id)) errs.push('id reused: ' + id); seen.add(id);
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(String(p.key || ''))) errs.push('bad key: ' + p.key);
      if (AXES.indexOf(p.axis) < 0) errs.push('unknown axis: ' + p.key + ' ' + p.axis);
      if (RARITIES.indexOf(p.rarity) < 0) errs.push('unknown rarity: ' + p.key + ' ' + p.rarity);
      if (SCOPES.indexOf(p.scope) < 0) errs.push('unknown scope: ' + p.key + ' ' + p.scope);
      if (!p.modes || typeof p.modes.solo !== 'boolean' || typeof p.modes.coop !== 'boolean' || typeof p.modes.duel !== 'boolean') errs.push('modes needs three booleans: ' + p.key);
      if (typeof p.rollable !== 'boolean') errs.push('rollable not boolean: ' + p.key);
      if (typeof p.icon !== 'string' || !p.icon) errs.push('missing icon: ' + p.key);
      if (!Array.isArray(p.lv) || p.lv.length !== 3) errs.push('lv must have 3 tiers: ' + p.key);
      if (!Array.isArray(p.p) || p.p.length !== 3) errs.push('p must have 3 tiers: ' + p.key);
      if (p.contract != null && typeof p.contract !== 'boolean') errs.push('contract not boolean: ' + p.key);
      if (p.seasons != null) {
        const s = p.seasons;
        if (typeof s !== 'object' || (s.from == null && s.until == null)) errs.push('seasons needs from and/or until: ' + p.key);
        else {
          if (s.from != null && !(s.from === (s.from | 0) && s.from >= 0)) errs.push('seasons.from must be int >= 0: ' + p.key);
          if (s.until != null && !(s.until === (s.until | 0) && s.until >= 0)) errs.push('seasons.until must be int >= 0: ' + p.key);
          if (s.from != null && s.until != null && (s.from | 0) > (s.until | 0)) errs.push('seasons.from > until: ' + p.key);
        }
      }
      if (p.contract) {
        if (p.rarity !== 'epic') errs.push('contract must be epic: ' + p.key);
        if (!p.rollable) errs.push('contract must be rollable: ' + p.key);
        if (!p.modes || p.modes.solo !== p.modes.coop) errs.push('contract modes.solo must equal modes.coop: ' + p.key);
      }
      (p.lv || []).forEach((e, k) => {
        for (const f of Object.keys(e || {})) {
          if (T1_FIELDS.indexOf(f) < 0 && RENDER_ONLY.indexOf(f) < 0) errs.push('effect field outside whitelist: ' + p.key + ' Lv' + (k + 1) + ' ' + f + ' (table/core/parity must change together)');
        }
        if (e && e.valueMul) for (const c of Object.keys(e.valueMul)) if (VALUE_MUL_KEYS.indexOf(c) < 0) errs.push('unknown valueMul class: ' + p.key + ' ' + c);
        if (e && e.invGrant) for (const c of Object.keys(e.invGrant)) if (INV_KEYS.indexOf(c) < 0) errs.push('unknown invGrant key: ' + p.key + ' ' + c);
        if (e && e.flags) for (const c of Object.keys(e.flags)) if (FLAG_KEYS.indexOf(c) < 0) errs.push('unknown flags key: ' + p.key + ' ' + c);
        for (const f of Object.keys(SUB_KEYS)) {
          if (!e || e[f] == null) continue;
          const keys = Object.keys(e[f]).sort(), want = SUB_KEYS[f].slice().sort();
          if (JSON.stringify(keys) !== JSON.stringify(want)) errs.push('bad ' + f + ' shape: ' + p.key + ' Lv' + (k + 1) + ' keys=' + keys.join(',') + ' (want ' + want.join(',') + ')');
          for (const sk of want) if (!(typeof e[f][sk] === 'number' && isFinite(e[f][sk]) && e[f][sk] >= 0)) errs.push('bad ' + f + '.' + sk + ' value: ' + p.key + ' Lv' + (k + 1));
        }
        if (e && e.combo && !(e.combo.every >= 2 && e.combo.mul >= 1)) errs.push('combo needs every>=2 && mul>=1: ' + p.key);
        if (e && e.emptyReturn && !(e.emptyReturn.cap >= 1 && e.emptyReturn.cap <= 30)) errs.push('emptyReturn.cap must be 1..30: ' + p.key);
        if (e && e.midas && !(e.midas.n >= 1 && e.midas.n <= 8)) errs.push('midas.n must be 1..8: ' + p.key);
        if (e && e.drill && !(e.drill.lv >= 1 && e.drill.lv <= 3)) errs.push('drill.lv must be 1..3: ' + p.key);
        if (e && e.shatterBonus != null && !(typeof e.shatterBonus === 'number' && e.shatterBonus >= 0 && e.shatterBonus === (e.shatterBonus | 0))) errs.push('shatterBonus must be int >= 0: ' + p.key);
        if (e && e.laser != null && !(e.laser >= 1 && e.laser <= 3)) errs.push('laser must be 1..3: ' + p.key);
        if (e && e.cursedMul != null && !(typeof e.cursedMul === 'number' && isFinite(e.cursedMul) && e.cursedMul !== 0)) errs.push('cursedMul must be a nonzero finite number: ' + p.key);
      });
    }
    for (const f of ONE_PER_TABLE) {
      const n = TABLE.filter(p => (p.lv || []).some(e => e && e[f] != null)).length;
      if (n > 1) errs.push('field ' + f + ' must appear on at most one perk (max semantics), found ' + n);
    }
    {
      const nc = TABLE.filter(p => p.contract).length;
      if (nc > 6) errs.push('too many contracts (' + nc + ' > 6)');
    }
    if (IT) {
      for (const k of Object.keys(IT)) if (!(k in ITEM_CLS)) errs.push('ITEMS key unclassified (add to ITEM_CLS): ' + k);
      for (const k of Object.keys(ITEM_CLS)) if (!(k in IT)) errs.push('ITEM_CLS ghost key (no such item): ' + k);
      for (const k of Object.keys(IT)) if (IT[k].isCursed && ITEM_CLS[k] !== 'cursed') errs.push('isCursed item must be class cursed: ' + k);
    }
    const C = cfg();
    const allMax = TABLE.map(p => Math.max.apply(null, p.lv.map(e => (e.valueMul && e.valueMul.all) || 1))).sort((a, b) => b - a);
    const top3All = (allMax[0] || 1) * (allMax[1] || 1) * (allMax[2] || 1);
    if (top3All > C.VALUE_MUL_CAP + 1e-9) errs.push('VALUE_MUL_CAP exceeded: 3-slot all product ' + top3All + ' > ' + C.VALUE_MUL_CAP);
    for (const c of CLS_KEYS) {
      const m = TABLE.map(p => Math.max.apply(null, p.lv.map(e => (e.valueMul && e.valueMul[c]) || 1))).sort((a, b) => b - a);
      const top3 = (m[0] || 1) * (m[1] || 1) * (m[2] || 1);
      if (top3 > C.CLASS_MUL_CAP + 1e-9) errs.push('CLASS_MUL_CAP exceeded: class ' + c + ' 3-slot product ' + top3 + ' > ' + C.CLASS_MUL_CAP);
    }
    {
      const neg = TABLE.map(p => Math.min.apply(null, p.lv.map(e => (e && e.levelTimeAdd < 0) ? e.levelTimeAdd : 0))).sort((a, b) => a - b);
      const worst3 = (neg[0] || 0) + (neg[1] || 0) + (neg[2] || 0);
      const minAdd = (typeof C.TIME_ADD_MIN === 'number') ? C.TIME_ADD_MIN : FALLBACK.TIME_ADD_MIN;
      if (worst3 < minAdd - 1e-9) errs.push('TIME_ADD_MIN exceeded: 3-slot negative time ' + worst3 + ' < ' + minAdd);
      const cm = TABLE.map(p => Math.max.apply(null, p.lv.map(e => (e && e.cursedMul != null) ? Math.abs(e.cursedMul) : 1))).sort((a, b) => b - a);
      const top3c = (cm[0] || 1) * (cm[1] || 1) * (cm[2] || 1);
      if (top3c > 3 + 1e-9) errs.push('CURSED_MUL_CAP exceeded: 3-slot |cursedMul| product ' + top3c + ' > 3');
    }
    return errs;
  }
  function isContract(id) { const p = get(id); return !!(p && p.contract); }
  function inSeason(p, seasonId) {
    const s = p && p.seasons;
    if (!s) return true;
    const id = seasonId | 0;
    if (s.from != null && id < (s.from | 0)) return false;
    if (s.until != null && id > (s.until | 0)) return false;
    return true;
  }
  function _fnv1a(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function poolEntries() {
    return TABLE.slice().sort((a, b) => (a.id | 0) - (b.id | 0)).map(p => ({
      id: p.id | 0, key: String(p.key), axis: p.axis, rarity: p.rarity, scope: p.scope,
      modes: { solo: !!(p.modes && p.modes.solo), coop: !!(p.modes && p.modes.coop), duel: !!(p.modes && p.modes.duel) },
      rollable: !!p.rollable, contract: !!p.contract,
      seasons: p.seasons ? { from: p.seasons.from == null ? null : (p.seasons.from | 0), until: p.seasons.until == null ? null : (p.seasons.until | 0) } : null,
    }));
  }
  function poolSig() { return ('00000000' + _fnv1a(JSON.stringify(poolEntries())).toString(16)).slice(-8); }
  function packBuild(slots) {
    let v = 0;
    for (let k = 0; k < 3; k++) {
      const s = slots && slots[k];
      if (!s || !(s.id | 0)) continue;
      v |= (((s.id | 0) & 0x7f) | (((s.lv | 0) & 3) << 7)) << (9 * k);
    }
    return v >>> 0;
  }
  function unpackBuild(v) {
    const out = [null, null, null];
    v = v >>> 0;
    for (let k = 0; k < 3; k++) {
      const w = (v >>> (9 * k)) & 0x1ff;
      const id = w & 0x7f, lv = (w >>> 7) & 3;
      if (id) out[k] = { id, lv: lv || 1, slot: k };
    }
    return out;
  }
  function heldOf(build) { return unpackBuild(build).filter(Boolean); }
  function isEmpty(build) { return ((build >>> 0) & 0x7ffffff) === 0; }
  function buildValid(build) {
    if ((build >>> 0) > 0x7ffffff) return false;
    const seen = new Set();
    for (const s of heldOf(build)) {
      if (!get(s.id) || s.lv < 1 || s.lv > 3 || seen.has(s.id)) return false;
      seen.add(s.id);
    }
    return true;
  }
  function emptyPicks() { const a = []; for (let i = 0; i < FALLBACK.MAX_DRAWS; i++) a.push(0); return a; }
  function packPicks(arr) {
    let lo = 0, hi = 0;
    for (let k = 0; k < 20; k++) {
      const v = ((arr && arr[k]) | 0) & 7;
      if (!v) continue;
      const b = 3 * k;
      if (b + 3 <= 32) lo |= v << b;
      else if (b >= 32) hi |= v << (b - 32);
      else { lo |= (v << b); hi |= v >>> (32 - b); }
    }
    return { lo: lo | 0, hi: hi | 0 };
  }
  function unpackPicks(lo, hi) {
    lo = lo >>> 0; hi = hi >>> 0;
    const out = [];
    for (let k = 0; k < 20; k++) {
      const b = 3 * k;
      let v;
      if (b + 3 <= 32) v = (lo >>> b) & 7;
      else if (b >= 32) v = (hi >>> (b - 32)) & 7;
      else v = ((lo >>> b) | (hi << (32 - b))) & 7;
      out.push(v);
    }
    return out;
  }
  function picksCount(arr) {
    let n = 0, ended = false;
    for (let k = 0; k < 20; k++) {
      const v = (arr && arr[k]) | 0;
      if (v < 0 || v > 5) return -1;
      if (v) { if (ended) return -1; n++; } else ended = true;
    }
    return n;
  }
  function drawEvery() { return (cfg().DRAW_EVERY | 0) || FALLBACK.DRAW_EVERY; }
  function gateEvery() { return (cfg().GATE_EVERY | 0) || FALLBACK.GATE_EVERY; }
  function maxDraws() { return Math.min(20, (cfg().MAX_DRAWS | 0) || FALLBACK.MAX_DRAWS); }
  function drawIdxAt(depth) {
    const d = depth | 0;
    if (d <= 0 || d % drawEvery() !== 0) return -1;
    const k = d / drawEvery() - 1;
    return k < maxDraws() ? k : -1;
  }
  function depthOfDraw(k) { return ((k | 0) + 1) * drawEvery(); }
  function isGateDepth(depth) { const d = depth | 0; return d > 0 && d % gateEvery() === 0; }
  function maxDrawsByDepth(depth) { return Math.min(maxDraws(), Math.floor(Math.max(0, depth | 0) / drawEvery())); }
  function seasonSeed(seasonId) { return window.RNG.deriveSeed(seasonId | 0, SEASON_SALT); }
  function drawSeed(sSeed, depth, build) {
    const R = window.RNG;
    return R.deriveSeed(R.deriveSeed(R.deriveSeed(sSeed | 0, PERK_SALT), depth | 0), build >>> 0);
  }
  function _weightedRarity(rng, weights, avail) {
    let tot = 0;
    for (let r = 0; r < 3; r++) if (avail[r]) tot += weights[r] | 0;
    if (tot <= 0) { for (let r = 0; r < 3; r++) if (avail[r]) return r; return -1; }
    let x = Math.floor(rng() * tot), acc = 0;
    for (let r = 0; r < 3; r++) {
      if (!avail[r]) continue;
      acc += weights[r] | 0;
      if (x < acc) return r;
    }
    return 2;
  }
  function _pickByRarity(rng, cands, weights, minRarity) {
    if (!cands.length) return null;
    const tiers = [[], [], []];
    for (const c of cands) tiers[RARITIES.indexOf(get(c.id).rarity)].push(c);
    const avail = tiers.map((t, r) => t.length > 0 && r >= (minRarity | 0));
    let r = _weightedRarity(rng, weights, avail);
    if (r < 0) { r = _weightedRarity(rng, weights, tiers.map(t => t.length > 0)); }
    if (r < 0) return null;
    const t = tiers[r];
    return t[Math.floor(rng() * t.length)];
  }
  function _pickUniform(rng, cands) { return cands.length ? cands[Math.floor(rng() * cands.length)] : null; }
  function _cardNew(p, slot) { return { id: p.id, lv: 1, tag: 'new', slot }; }
  function _cardUp(s) { return { id: s.id, lv: s.lv + 1, tag: 'up', slot: s.slot }; }
  function _cardReplace(p, slot) { return { id: p.id, lv: 1, tag: 'replace', slot }; }
  function _firstEmpty(slots) { for (let k = 0; k < 3; k++) if (!slots[k]) return k; return -1; }
  function _replaceTarget(slots) {
    let best = -1;
    for (let k = 0; k < 3; k++) { const s = slots[k]; if (!s) continue; if (best < 0 || s.lv < slots[best].lv) best = k; }
    return best;
  }
  function _not(cards, id) { return !cards.some(c => c.id === id); }
  function candidates(sSeed, depth, build, drawIdx, skipBank, opts) {
    const mode = (opts && opts.mode) || 'solo';
    const sid = (opts && opts.seasonId != null) ? (opts.seasonId | 0) : 0;
    const rng = window.makeRNG(drawSeed(sSeed, depth, build));
    const slots = unpackBuild(build);
    const held = slots.filter(Boolean);
    const heldIds = new Set(held.map(s => s.id));
    const heldAxes = new Set(held.map(s => get(s.id) && get(s.id).axis));
    const poolAll = TABLE.filter(p => p.rollable && p.modes && p.modes[mode] && inSeason(p, sid));
    const pool = poolAll.filter(p => !p.contract);
    const cPool = poolAll.filter(p => p.contract && !heldIds.has(p.id));
    const n = 3 + (skipBank ? 1 : 0);
    const k = drawIdx | 0;
    const band = Math.min(3, Math.floor(Math.max(0, depth | 0) / gateEvery()));
    const gate = k > 0 && isGateDepth(depth);
    const weights = k === 0 ? [100, 0, 0] : (gate ? RARITY_GATE[band] : RARITY_BY_BAND[band]);
    const pity = k > 0 && !gate && ((k % ((cfg().PITY_EVERY | 0) || FALLBACK.PITY_EVERY)) === ((cfg().PITY_EVERY | 0) || FALLBACK.PITY_EVERY) - 1);
    const seen = (opts && opts.contractsSeen) | 0;
    const cEligible = k >= cfgNum('CONTRACT_MIN_DRAW') && seen < cfgNum('CONTRACT_MAX') && cPool.length > 0;
    const rollContract = (mk) => {
      if (!cEligible) return null;
      if (Math.floor(rng() * 1000) >= cfgNum('CONTRACT_P_MILLI')) return null;
      return mk(cPool[Math.floor(rng() * cPool.length)]);
    };
    const cards = [];
    const full = held.length >= 3;
    const upgrades = held.filter(s => s.lv < 3).map(_cardUp);
    const unheld = pool.filter(p => !heldIds.has(p.id));
    const freeSlot = _firstEmpty(slots);
    if (full) {
      const tgt = _replaceTarget(slots);
      const u1 = _pickUniform(rng, upgrades); if (u1) cards.push(u1);
      const u2 = _pickUniform(rng, upgrades.filter(c => _not(cards, c.id))); if (u2) cards.push(u2);
      const cc = rollContract(p => _cardReplace(p, tgt));
      if (cc) cards.push(cc);
      else { const r1 = _pickByRarity(rng, unheld.map(p => _cardReplace(p, tgt)), weights, pity ? 1 : 0); if (r1) cards.push(r1); }
      while (cards.length < n) {
        const more = _pickByRarity(rng, unheld.filter(p => _not(cards, p.id)).map(p => _cardReplace(p, tgt)), weights, 0);
        if (!more) break; cards.push(more);
      }
    } else {
      const sameAxis = unheld.filter(p => heldAxes.has(p.axis)).map(p => _cardNew(p, freeSlot));
      let a = _pickUniform(rng, upgrades.concat(sameAxis));
      if (!a) a = _pickByRarity(rng, unheld.map(p => _cardNew(p, freeSlot)), weights, 0);
      if (a) cards.push(a);
      const newAxis = unheld.filter(p => !heldAxes.has(p.axis) && _not(cards, p.id)).map(p => _cardNew(p, freeSlot));
      let b = _pickByRarity(rng, newAxis, weights, 0);
      if (!b) b = _pickByRarity(rng, unheld.filter(p => _not(cards, p.id)).map(p => _cardNew(p, freeSlot)).concat(upgrades.filter(c => _not(cards, c.id))), weights, 0);
      if (b) cards.push(b);
      const cc = rollContract(p => _cardNew(p, freeSlot));
      if (cc) cards.push(cc);
      while (cards.length < n) {
        const freeC = unheld.filter(p => _not(cards, p.id)).map(p => _cardNew(p, freeSlot)).concat(upgrades.filter(c => _not(cards, c.id)));
        const c = _pickByRarity(rng, freeC, weights, (pity && cards.length === 2) ? 1 : 0);
        if (!c) break; cards.push(c);
      }
    }
    return cards;
  }
  function hasContract(cards) { return !!(cards && cards.some(c => isContract(c.id))); }
  function contractsSeenBefore(sSeed, picksArr, k, opts) {
    const mode = (opts && opts.mode) || 'solo';
    const seasonId = (opts && opts.seasonId != null) ? (opts.seasonId | 0) : 0;
    let build = 0, skipBank = 0, seen = 0;
    const cnt = picksCount(picksArr);
    const kk = Math.min(k | 0, cnt < 0 ? 0 : cnt);
    for (let j = 0; j < kk; j++) {
      const choice = picksArr[j] | 0;
      const cards = candidates(sSeed, depthOfDraw(j), build, j, skipBank, { mode, contractsSeen: seen, seasonId });
      if (hasContract(cards)) seen++;
      if (choice === 5) { skipBank = 1; continue; }
      const nb = applyPick(build, cards, choice);
      if (nb == null) break;
      build = nb; skipBank = 0;
    }
    return seen;
  }
  function applyPick(build, cards, choice) {
    const c = choice | 0;
    if (c === 5) return build >>> 0;
    if (c < 1 || c > 4 || c > cards.length) return null;
    const card = cards[c - 1];
    const slots = unpackBuild(build);
    const slot = card.slot | 0;
    if (slot < 0 || slot > 2) return null;
    if (card.tag === 'up') { if (!slots[slot] || slots[slot].id !== card.id || slots[slot].lv + 1 !== card.lv) return null; }
    else { if (slots.some((s, k) => s && s.id === card.id && k !== slot)) return null; if (card.tag === 'new' && slots[slot]) return null; }
    slots[slot] = { id: card.id, lv: card.lv, slot };
    return packBuild(slots);
  }
  function pickApply(E, drawIdx, choice, slot, id, lv) {
    if (!E) return false;
    const di = drawIdx | 0, c = choice | 0;
    if (di !== (E.drawIdx | 0) || di < 0 || di >= maxDraws()) return false;
    if (c < 1 || c > 5) return false;
    let nb = E.build >>> 0;
    if (c === 5) {
      if ((slot | 0) !== -1 || (id | 0) !== 0 || (lv | 0) !== 0) return false;
    } else {
      const s = slot | 0, pid = id | 0, plv = lv | 0;
      if (s < 0 || s > 2) return false;
      if (!get(pid) || plv < 1 || plv > 3) return false;
      const slots = unpackBuild(nb);
      const cur = slots[s];
      if (cur && cur.id === pid) { if (plv !== cur.lv + 1) return false; }
      else {
        if (plv !== 1) return false;
        if (slots.some((x, k) => x && k !== s && x.id === pid)) return false;
      }
      slots[s] = { id: pid, lv: plv, slot: s };
      nb = packBuild(slots);
    }
    if (!Array.isArray(E.picksArr) || E.picksArr.length !== 20) E.picksArr = emptyPicks();
    E.build = nb >>> 0;
    E.picksArr[di] = c;
    E.drawIdx = di + 1;
    E.skipBank = (c === 5) ? 1 : 0;
    return true;
  }
  function restoreRun(E, build, picksArr, drawIdx) {
    if (!E) return false;
    const di = drawIdx | 0;
    const arr = Array.isArray(picksArr) ? picksArr.slice(0, 20) : [];
    while (arr.length < 20) arr.push(0);
    if (di < 0 || di > maxDraws() || !buildValid(build)) return false;
    if (picksCount(arr) !== di) return false;
    let nonSkip = 0;
    for (let k = 0; k < di; k++) if ((arr[k] | 0) !== 5) nonSkip++;
    const lvSum = heldOf(build).reduce((s, x) => s + x.lv, 0);
    if (lvSum > nonSkip) return false;
    E.build = build >>> 0;
    E.picksArr = arr;
    E.drawIdx = di;
    E.skipBank = (di > 0 && (arr[di - 1] | 0) === 5) ? 1 : 0;
    return true;
  }
  function replay(sSeed, picksArr, endDepth, opts) {
    const n = picksCount(picksArr);
    if (n < 0) return { ok: false, why: 'picks-shape' };
    if (n > maxDrawsByDepth(endDepth)) return { ok: false, why: 'picks-count', at: n };
    let build = 0, skipBank = 0, seen = 0;
    const mode = (opts && opts.mode) || 'solo';
    const seasonId = (opts && opts.seasonId != null) ? (opts.seasonId | 0) : 0;
    for (let k = 0; k < n; k++) {
      const choice = picksArr[k] | 0;
      const cards = candidates(sSeed, depthOfDraw(k), build, k, skipBank, { mode, contractsSeen: seen, seasonId });
      if (hasContract(cards)) seen++;
      if (choice === 5) { skipBank = 1; continue; }
      if (choice === 4 && !skipBank) return { ok: false, why: 'pick-4-nobank', at: k };
      const nb = applyPick(build, cards, choice);
      if (nb == null) return { ok: false, why: 'pick-range', at: k };
      build = nb; skipBank = 0;
    }
    return { ok: true, build: build >>> 0, n, skipBank, contractsSeen: seen };
  }
  function effOfBuild(build) {
    const e = { valueMul: {}, clearBonusMul: 1, levelTimeAdd: 0, invGrant: { tnt: 0, freeze: 0 }, strengthBonus: 0, shopMul: 1,
      clover: false, hookSpeedMul: 1, pullSpeedMul: 1, freezeDurMul: 1, highlight: 0, slots: heldOf(build),
      cursedMul: 1, comboEvery: 0, comboMul: 1, emptyAmt: 0, emptyCap: 0, midasN: 0, midasValue: 0, drillLv: 0, shatterBonus: 0, laser: 0 };
    for (const c of VALUE_MUL_KEYS) e.valueMul[c] = 1;
    for (const s of e.slots) {
      const p = get(s.id); if (!p) continue;
      const L = p.lv[Math.max(0, Math.min(2, s.lv - 1))] || {};
      if (L.cursedMul != null) e.cursedMul = e.cursedMul * L.cursedMul;
      if (L.combo) { e.comboEvery = L.combo.every | 0; e.comboMul = +L.combo.mul; }
      if (L.emptyReturn) { e.emptyAmt = L.emptyReturn.amt | 0; e.emptyCap = L.emptyReturn.cap | 0; }
      if (L.midas) { e.midasN = L.midas.n | 0; e.midasValue = L.midas.value | 0; }
      if (L.drill) e.drillLv = Math.max(e.drillLv, L.drill.lv | 0);
      if (L.shatterBonus) e.shatterBonus = Math.max(e.shatterBonus, L.shatterBonus | 0);
      if (L.laser) e.laser = Math.max(e.laser, L.laser | 0);
      if (L.valueMul) for (const c of VALUE_MUL_KEYS) if (L.valueMul[c] != null) e.valueMul[c] = e.valueMul[c] * L.valueMul[c];
      if (L.clearBonusMul != null) e.clearBonusMul = e.clearBonusMul * L.clearBonusMul;
      if (L.levelTimeAdd) e.levelTimeAdd += L.levelTimeAdd;
      if (L.invGrant) { e.invGrant.tnt += (L.invGrant.tnt | 0); e.invGrant.freeze += (L.invGrant.freeze | 0); }
      if (L.strengthBonus) e.strengthBonus += L.strengthBonus;
      if (L.shopMul != null) e.shopMul = e.shopMul * L.shopMul;
      if (L.flags && L.flags.clover) e.clover = true;
      if (L.hookSpeedMul != null) e.hookSpeedMul = e.hookSpeedMul * L.hookSpeedMul;
      if (L.pullSpeedMul != null) e.pullSpeedMul = e.pullSpeedMul * L.pullSpeedMul;
      if (L.freezeDurMul != null) e.freezeDurMul = e.freezeDurMul * L.freezeDurMul;
      if (L.highlight) e.highlight = e.highlight ? Math.min(e.highlight, L.highlight) : L.highlight;
    }
    return e;
  }
  const NEUTRAL = effOfBuild(0);
  function valueMulOfBuild(build, cls) {
    let m = 1;
    for (const s of heldOf(build)) {
      const p = get(s.id); if (!p) continue;
      const L = p.lv[Math.max(0, Math.min(2, s.lv - 1))] || {};
      const vm = L.valueMul;
      if (!vm) continue;
      if (vm.all != null) m = m * vm.all;
      const ck = CLS_KEYS[cls | 0];
      if (ck && vm[ck] != null) m = m * vm[ck];
    }
    return m;
  }
  function buildOf(seat) {
    const G = window.GAME;
    const E = G && G.endless;
    return E ? (E.build >>> 0) : 0;
  }
  let _effCache = { build: -1, eff: NEUTRAL };
  function effOf(seat) {
    const b = buildOf(seat);
    if (_effCache.build !== b) _effCache = { build: b, eff: effOfBuild(b) };
    return _effCache.eff;
  }
  function valueMulOf(seat, cls) { return valueMulOfBuild(buildOf(seat), cls); }
  function levelTimeAddMax() {
    const G = window.GAME;
    if (!G || !G.endless) return 0;
    return effOfBuild(G.endless.build >>> 0).levelTimeAdd;
  }
  function nameKey(id) { const p = get(id); return p ? ('perk_' + p.key + '_name') : ''; }
  function descKey(id) { const p = get(id); return p ? ('perk_' + p.key + '_desc') : ''; }
  function descParams(id, lv) { const p = get(id); return p ? (p.p[Math.max(0, Math.min(2, (lv | 0) - 1))] || {}) : {}; }
  function iconOf(id) { const p = get(id); return p ? p.icon : ''; }
  function rarityOf(id) { const p = get(id); return p ? p.rarity : 'common'; }
  return {
    PERK_SALT, SEASON_SALT, CLS, CLS_KEYS, ITEM_CLS, T1_FIELDS, RENDER_ONLY, VALUE_MUL_KEYS, INV_KEYS, FLAG_KEYS, AXES, RARITIES, SCOPES,
    RARITY_BY_BAND, RARITY_GATE, FALLBACK,
    cfg, get, list, validateTable, clsOfItem, clsOfCreature,
    packBuild, unpackBuild, heldOf, isEmpty, buildValid,
    emptyPicks, packPicks, unpackPicks, picksCount,
    drawEvery, gateEvery, maxDraws, drawIdxAt, depthOfDraw, isGateDepth, maxDrawsByDepth,
    seasonSeed, drawSeed, candidates, applyPick, replay, pickApply, restoreRun,
    cfgNum, isContract, hasContract, contractsSeenBefore, SUB_KEYS, ONE_PER_TABLE,
    inSeason, poolEntries, poolSig,
    effOfBuild, valueMulOfBuild, buildOf, effOf, valueMulOf, levelTimeAddMax, NEUTRAL,
    nameKey, descKey, descParams, iconOf, rarityOf,
    _setTableForTest(list) { TABLE = list || LIST; _index(); _effCache = { build: -1, eff: effOfBuild(0) }; },
  };
})();
