// generated file: comments stripped from the client-side source; regenerate with the companion repo's scripts/gen-perks-vendor.js (byte-locked there)
window.PERKS = (() => {
  const FALLBACK = { SLOTS: 3, MAX_DRAWS: 20, DRAW_EVERY: 5, GATE_EVERY: 10, PICK_TIMEOUT_S: 20, PITY_EVERY: 3,
    CONTRACT_MAX: 2, CONTRACT_MIN_DRAW: 3, CONTRACT_P_MILLI: 350, TIME_ADD_MIN: -20, VALUE_MUL_CAP: 1.9, CLASS_MUL_CAP: 20, TABLE_VER: 2 };
  function cfg() {
    const R = window.RANKED_CONFIG;
    return (R && R.ENDLESS && R.ENDLESS.PERKS) || FALLBACK;
  }
  function cfgNum(key) { const v = cfg()[key]; return (typeof v === 'number') ? v : FALLBACK[key]; }
  const PERK_SALT = 0x9E4B;
  const SEASON_SALT = 0x5EA5;
  const CLS_KEYS = ['gold', 'rock', 'bone', 'gem', 'cursed', 'creature', 'other', 'relic'];
  const CLS = {}; CLS_KEYS.forEach((k, i) => { CLS[k] = i; });
  const CLASS_TOTAL_CAP = { gold: 2, rock: 6, bone: 40, gem: 3 };
  const CURSED_FLIP_MIN = -1;
  const ITEM_CLS = {
    goldSmall: 'gold', goldMid: 'gold', goldLarge: 'gold', goldHuge: 'gold',
    rockSmall: 'rock', rockLarge: 'rock',
    bone: 'bone', skull: 'bone', boneAncient: 'relic', skullAncient: 'relic',
    diamond: 'gem', gemTurquoise: 'gem', pearl: 'gem', opal: 'gem',
    cursedSkull: 'cursed',
    mysteryBag: 'other', doomBag: 'other', tntPickup: 'other', tntShard: 'other', freezeBox: 'other', slotCoin: 'other',
    chip: 'other', dice: 'other', idol: 'other',
    cobweb: 'other', vine: 'other', icicle: 'other', coral: 'other', plank: 'other',
    safe: 'other', couponDiscount: 'other', couponFree: 'other', dualBag: 'other',
    clGoldSmall: 'gold', clGoldMid: 'gold', clGoldLarge: 'gold', clGoldHuge: 'gold', clDiamond: 'gem', clBone: 'bone', clSkull: 'bone',
    clRockSmall: 'rock', clRockLarge: 'rock', clMysteryBag: 'other', clTnt: 'other',
  };
  function clsOfItem(key) { const c = ITEM_CLS[key]; return c == null ? CLS.other : CLS[c]; }
  function clsOfCreature() { return CLS.creature; }
  const T1_FIELDS = ['valueMul', 'clearBonusMul', 'levelTimeAdd', 'invGrant', 'strengthBonus', 'shopMul', 'flags',
    'cursedMul', 'combo', 'emptyReturn', 'midas', 'drill', 'shatterBonus'];
  const VALUE_MUL_KEYS = CLS_KEYS.concat(['all']);
  const INV_KEYS = ['tnt', 'freeze'];
  const FLAG_KEYS = ['clover'];
  const SUB_KEYS = { combo: ['every', 'mul'], emptyReturn: ['amt', 'cap'], midas: ['n', 'value'], drill: ['lv'], openPull: ['secs', 'mul'], lightPull: ['wMax', 'mul'] };
  const ONE_PER_TABLE = ['combo', 'emptyReturn', 'midas', 'drill', 'openPull', 'lightPull'];
  const RENDER_ONLY = ['hookSpeedMul', 'pullSpeedMul', 'freezeDurMul', 'highlight', 'laser', 'emptyPullMul',
    'swingNatMul', 'openPull', 'lightPull', 'hitRadiusMul', 'mechVeteran', 'blind', 'topLit'];
  const FIELD_SPEC = Object.freeze({ hookSpeedMul: 'mul', pullSpeedMul: 'mul', freezeDurMul: 'mul', highlight: 'minPos', laser: 'max', emptyPullMul: 'mul',
    swingNatMul: 'mul', openPull: 'one', lightPull: 'one', hitRadiusMul: 'mul', mechVeteran: 'max', blind: 'or', topLit: 'max' });
  const AXES = ['time', 'value', 'speed', 'item', 'neg', 'economy', 'collect', 'life', 'info'];
  const RARITIES = ['common', 'rare', 'epic'];
  const SCOPES = ['self', 'team', 'world'];
  const RARITY_BY_BAND = [[100, 0, 0], [85, 13, 2], [75, 20, 5], [65, 27, 8]];
  const RARITY_GATE = [[0, 85, 15], [0, 80, 20], [0, 70, 30], [0, 60, 40]];
  const LIST = [
    { id: 1, key: 'timekeeper', axis: 'time', rarity: 'common', scope: 'team', modes: { solo: true, coop: true, duel: false }, rollable: true, icon: '⏱',
      lv: [{ levelTimeAdd: 10 }, { levelTimeAdd: 15 }, { levelTimeAdd: 20 }], p: [{ a: 10 }, { a: 15 }, { a: 20 }] },
    { id: 2, key: 'timeIsMoney', axis: 'time', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '⏳',
      lv: [{ levelTimeAdd: -5, valueMul: { all: 1.12 } }, { levelTimeAdd: -5, valueMul: { all: 1.16 } }, { levelTimeAdd: -5, valueMul: { all: 1.2 } }], p: [{ a: 1.12, b: 5 }, { a: 1.16, b: 5 }, { a: 1.2, b: 5 }] },
    { id: 3, key: 'rockLover', axis: 'value', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '🪨',
      lv: [{ valueMul: { rock: 3.5, gold: 0.92 } }, { valueMul: { rock: 4, gold: 0.92 } }, { valueMul: { rock: 4.5, gold: 0.92 } }], p: [{ a: 3.5, b: 8, c: 6 }, { a: 4, b: 8, c: 6 }, { a: 4.5, b: 8, c: 6 }] },
    { id: 4, key: 'boneDealer', axis: 'value', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '💀',
      lv: [{ valueMul: { bone: 10, relic: 1.75 } }, { valueMul: { bone: 15, relic: 2 } }, { valueMul: { bone: 20, relic: 2.25 } }], p: [{ a: 10, b: 1.75, c: 40 }, { a: 15, b: 2, c: 40 }, { a: 20, b: 2.25, c: 40 }] },
    { id: 5, key: 'pyrotechnician', axis: 'item', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '🧨',
      lv: [{ invGrant: { tnt: 1 } }, { invGrant: { tnt: 2 } }, { invGrant: { tnt: 3 } }], p: [{ a: 1 }, { a: 2 }, { a: 3 }] },
    { id: 6, key: 'coldStorage', axis: 'item', rarity: 'common', scope: 'self', modes: { solo: false, coop: true, duel: true }, rollable: true, icon: '❄',
      lv: [{ invGrant: { freeze: 1 }, freezeDurMul: 1.5 }, { invGrant: { freeze: 1 }, freezeDurMul: 2 }, { invGrant: { freeze: 1 }, freezeDurMul: 2.5 }], p: [{ a: 1.5 }, { a: 2 }, { a: 2.5 }] },
    { id: 7, key: 'strengthTraining', axis: 'speed', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '💪',
      lv: [{ strengthBonus: 3 }, { strengthBonus: 5 }, { strengthBonus: 7 }], p: [{ a: 3 }, { a: 5 }, { a: 7 }] },
    { id: 8, key: 'quickHands', axis: 'speed', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '🚀',
      lv: [{ hookSpeedMul: 1.25, pullSpeedMul: 1.25 }, { hookSpeedMul: 1.35, pullSpeedMul: 1.35 }, { hookSpeedMul: 1.45, pullSpeedMul: 1.45 }], p: [{ a: 25 }, { a: 35 }, { a: 45 }] },
    { id: 9, key: 'eagleEye', axis: 'info', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '👁',
      lv: [{ topLit: 1 }, { topLit: 2 }, { topLit: 3 }], p: [{ a: 1 }, { a: 2 }, { a: 3 }] },
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
      lv: [{ emptyReturn: { amt: 60, cap: 6 } }, { emptyReturn: { amt: 100, cap: 6 } }, { emptyReturn: { amt: 130, cap: 6 } }], p: [{ a: 60, b: 6 }, { a: 100, b: 6 }, { a: 130, b: 6 }] },
    { id: 17, key: 'midas', axis: 'value', rarity: 'rare', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: '✨',
      lv: [{ midas: { n: 3, value: 400 } }, { midas: { n: 4, value: 450 } }, { midas: { n: 5, value: 500 } }], p: [{ a: 3, b: 400 }, { a: 4, b: 450 }, { a: 5, b: 500 }] },
    { id: 18, key: 'greedPact', axis: 'value', rarity: 'epic', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, contract: true, icon: '📜',
      lv: [{ valueMul: { all: 1.28 }, levelTimeAdd: -10 }, { valueMul: { all: 1.42 }, levelTimeAdd: -13 }, { valueMul: { all: 1.55 }, levelTimeAdd: -15 }], p: [{ a: 1.28, b: 10 }, { a: 1.42, b: 13 }, { a: 1.55, b: 15 }] },
    { id: 19, key: 'glassCannon', axis: 'speed', rarity: 'epic', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, contract: true, icon: '⚡',
      lv: [{ hookSpeedMul: 1.5, pullSpeedMul: 1.5, strengthBonus: 2, cursedMul: 2, emptyPullMul: 0.35 }, { hookSpeedMul: 1.75, pullSpeedMul: 1.75, strengthBonus: 3, cursedMul: 2.5, emptyPullMul: 0.28 },
        { hookSpeedMul: 2, pullSpeedMul: 2, strengthBonus: 5, cursedMul: 3, emptyPullMul: 0.22 }], p: [{ a: 50, b: 2, c: 2, d: 35 }, { a: 75, b: 2.5, c: 3, d: 28 }, { a: 100, b: 3, c: 5, d: 22 }] },
    { id: 20, key: 'miserPact', axis: 'economy', rarity: 'epic', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, contract: true, icon: '💰',
      lv: [{ shopMul: 0.5, clearBonusMul: 0 }, { shopMul: 0.4, clearBonusMul: 0 }, { shopMul: 0.3, clearBonusMul: 0 }], p: [{ a: 50 }, { a: 40 }, { a: 30 }] },
    { id: 21, key: 'jeweler', axis: 'value', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, rulesFrom: 2, tags: ['class'], role: 'steady', icon: '💎',
      lv: [{ valueMul: { gem: 1.12, rock: 0.5 } }, { valueMul: { gem: 1.18, rock: 0.5 } }, { valueMul: { gem: 1.24, rock: 0.5 } }], p: [{ a: 1.12, b: 50 }, { a: 1.18, b: 50 }, { a: 1.24, b: 50 }] },
    { id: 22, key: 'prospector', axis: 'value', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, rulesFrom: 2, tags: ['class'], role: 'steady', icon: '🏅',
      lv: [{ valueMul: { gold: 1.35, gem: 0.85 } }, { valueMul: { gold: 1.45, gem: 0.85 } }, { valueMul: { gold: 1.55, gem: 0.85 } }], p: [{ a: 1.35, b: 15 }, { a: 1.45, b: 15 }, { a: 1.55, b: 15 }] },
    { id: 23, key: 'trapper', axis: 'value', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, rulesFrom: 2, tags: ['class'], role: 'steady', icon: '🪤',
      lv: [{ valueMul: { creature: 1.3, rock: 0.5 } }, { valueMul: { creature: 1.45, rock: 0.5 } }, { valueMul: { creature: 1.6, rock: 0.5 } }], p: [{ a: 1.3, b: 50 }, { a: 1.45, b: 50 }, { a: 1.6, b: 50 }] },
    { id: 24, key: 'slowAndSteady', axis: 'time', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, rulesFrom: 2, tags: ['time'], role: 'steady', icon: '🐢',
      lv: [{ levelTimeAdd: 15, hookSpeedMul: 0.8 }, { levelTimeAdd: 20, hookSpeedMul: 0.8 }, { levelTimeAdd: 25, hookSpeedMul: 0.8 }], p: [{ a: 15, b: 20 }, { a: 20, b: 20 }, { a: 25, b: 20 }] },
    { id: 25, key: 'boomerang', axis: 'speed', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, rulesFrom: 2, tags: ['rhythm'], role: 'swing', icon: '🪃',
      lv: [{ emptyPullMul: 3, hookSpeedMul: 1.1 }, { emptyPullMul: 3.5, hookSpeedMul: 1.15 }, { emptyPullMul: 4, hookSpeedMul: 1.25 }], p: [{ a: 3, b: 10 }, { a: 3.5, b: 15 }, { a: 4, b: 25 }] },
    { id: 26, key: 'steadyHand', axis: 'info', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, rulesFrom: 2, tags: ['quick'], role: 'utility', icon: '🧭',
      lv: [{ swingNatMul: 0.8 }, { swingNatMul: 0.7 }, { swingNatMul: 0.6 }], p: [{ a: 20 }, { a: 30 }, { a: 40 }] },
    { id: 27, key: 'openingRush', axis: 'time', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, rulesFrom: 2, tags: ['time'], role: 'swing', icon: '🏃',
      lv: [{ openPull: { secs: 15, mul: 3 } }, { openPull: { secs: 25, mul: 3 } }, { openPull: { secs: 35, mul: 3 } }], p: [{ a: 15, b: 3 }, { a: 25, b: 3 }, { a: 35, b: 3 }] },
    { id: 28, key: 'travelLight', axis: 'speed', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, rulesFrom: 2, tags: ['quick'], role: 'steady', icon: '🪶',
      lv: [{ lightPull: { wMax: 7, mul: 1.6 } }, { lightPull: { wMax: 8, mul: 1.8 } }, { lightPull: { wMax: 9, mul: 2 } }], p: [{ a: 7, b: 1.6 }, { a: 8, b: 1.8 }, { a: 9, b: 2 }] },
    { id: 29, key: 'magnetClaw', axis: 'speed', rarity: 'epic', scope: 'self', modes: { solo: true, coop: true, duel: false }, rollable: true, rulesFrom: 2, tags: ['quick'], role: 'swing', icon: '🧲',
      lv: [{ hitRadiusMul: 1.25 }, { hitRadiusMul: 1.4 }, { hitRadiusMul: 1.6 }], p: [{ a: 25 }, { a: 40 }, { a: 60 }] },
    { id: 30, key: 'oldMiner', axis: 'info', rarity: 'rare', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, rulesFrom: 2, tags: ['deep'], role: 'utility', minDepth: 10, excl: [31], icon: '🔦',
      lv: [{ mechVeteran: 1 }, { mechVeteran: 2 }, { mechVeteran: 3 }], p: [{}, {}, {}] },
    { id: 31, key: 'blindDig', axis: 'value', rarity: 'epic', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, contract: true, rulesFrom: 2, tags: ['class'], role: 'swing', excl: [30], icon: '🕶',
      lv: [{ valueMul: { gold: 1.35, gem: 1.3 }, blind: true }, { valueMul: { gold: 1.5, gem: 1.4 }, blind: true }, { valueMul: { gold: 1.65, gem: 1.5 }, blind: true }], p: [{ a: 1.35, b: 1.3 }, { a: 1.5, b: 1.4 }, { a: 1.65, b: 1.5 }] },
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
      for (const k of Object.keys(IT)) if (ITEM_CLS[k] === 'relic' && IT[k].bonusKey) errs.push('relic item must not carry a bonusKey: ' + k);
    }
    for (const c of Object.keys(CLASS_TOTAL_CAP)) {
      if (CLS_KEYS.indexOf(c) < 0) errs.push('CLASS_TOTAL_CAP unknown class: ' + c);
      else if (!(typeof CLASS_TOTAL_CAP[c] === 'number' && isFinite(CLASS_TOTAL_CAP[c]) && CLASS_TOTAL_CAP[c] > 0)) errs.push('CLASS_TOTAL_CAP must be > 0: ' + c);
      if (c === 'creature' || c === 'relic' || c === 'cursed' || c === 'other') errs.push('CLASS_TOTAL_CAP must not cap class: ' + c);
    }
    if (!(CURSED_FLIP_MIN < 0)) errs.push('CURSED_FLIP_MIN must be negative');
    const num = (v) => typeof v === 'number' && isFinite(v);
    for (const p of TABLE) (p.lv || []).forEach((e, k) => {
      const at = p.key + ' Lv' + (k + 1);
      if (!e) return;
      if (e.emptyPullMul != null && !(num(e.emptyPullMul) && e.emptyPullMul > 0 && e.emptyPullMul <= 5)) errs.push('emptyPullMul must be in (0, 5]: ' + at);
      if (e.swingNatMul != null && !(num(e.swingNatMul) && e.swingNatMul > 0 && e.swingNatMul <= 2)) errs.push('swingNatMul must be in (0, 2]: ' + at);
      if (e.hitRadiusMul != null && !(num(e.hitRadiusMul) && e.hitRadiusMul >= 1 && e.hitRadiusMul <= 2)) errs.push('hitRadiusMul must be in [1, 2]: ' + at);
      if (e.mechVeteran != null && !(e.mechVeteran === (e.mechVeteran | 0) && e.mechVeteran >= 1 && e.mechVeteran <= 3)) errs.push('mechVeteran must be int 1..3: ' + at);
      if (e.topLit != null && !(e.topLit === (e.topLit | 0) && e.topLit >= 1 && e.topLit <= 5)) errs.push('topLit must be int 1..5: ' + at);
      if (e.blind != null && e.blind !== true) errs.push('blind must be true: ' + at);
      if (e.openPull && !(e.openPull.secs >= 1 && e.openPull.secs <= 60 && e.openPull.mul > 1 && e.openPull.mul <= 3)) errs.push('openPull needs secs 1..60 and mul (1, 3]: ' + at);
      if (e.lightPull && !(e.lightPull.wMax >= 1 && e.lightPull.wMax <= 20 && e.lightPull.mul > 1 && e.lightPull.mul <= 2)) errs.push('lightPull needs wMax 1..20 and mul (1, 2]: ' + at);
    });
    for (const f of RENDER_ONLY) if (!FIELD_SPEC[f]) errs.push('RENDER_ONLY field without FIELD_SPEC stacking rule: ' + f);
    for (const f of Object.keys(FIELD_SPEC)) if (RENDER_ONLY.indexOf(f) < 0) errs.push('FIELD_SPEC ghost field (not RENDER_ONLY): ' + f);
    {
      const pos = TABLE.map(p => Math.max.apply(null, p.lv.map(e => (e && e.levelTimeAdd > 0) ? e.levelTimeAdd : 0))).sort((a, b) => b - a);
      const best3 = (pos[0] || 0) + (pos[1] || 0) + (pos[2] || 0);
      if (best3 > 60 + 1e-9) errs.push('positive time cap exceeded: 3-slot positive time ' + best3 + ' > 60');
    }
    for (const p of TABLE) {
      const id = p.id | 0;
      if (p.rulesFrom != null && !(p.rulesFrom === (p.rulesFrom | 0) && p.rulesFrom >= 2)) errs.push('rulesFrom must be int >= 2: ' + p.key);
      if (p.rulesFrom == null && !V2_META[id] && (p.tags == null || p.role == null)) errs.push('v1 entry missing V2_META (tags / role for rules v2): ' + p.key);
      if (p.rulesFrom != null && (p.tags == null || p.role == null)) errs.push('rules v2 entry must carry tags and role: ' + p.key);
      const f = poolFieldOf(p, V2_DEFAULT_OVERLAY);
      if (!Array.isArray(f.tags) || !f.tags.length || f.tags.some(t => TAGS.indexOf(t) < 0)) errs.push('tags must be a non-empty subset of TAGS: ' + p.key);
      if (ROLES.indexOf(f.role) < 0) errs.push('unknown role: ' + p.key + ' ' + f.role);
      if (p.minDepth != null && !(p.minDepth === (p.minDepth | 0) && p.minDepth >= 0)) errs.push('minDepth must be int >= 0: ' + p.key);
      if (p.needs != null && p.needs !== 'coop2') errs.push('unknown needs: ' + p.key + ' ' + p.needs);
      if (p.excl != null) {
        if (!Array.isArray(p.excl)) errs.push('excl must be an array: ' + p.key);
        else for (const x of p.excl) {
          const q = get(x);
          if (!q || x === id) errs.push('excl points at unknown / self id: ' + p.key + ' -> ' + x);
          else if (!Array.isArray(q.excl) || q.excl.indexOf(id) < 0) errs.push('excl must be symmetric: ' + p.key + ' -> ' + q.key);
        }
      }
      if (p.rulesFrom != null) {
        for (let k = 0; k < 2; k++) if (JSON.stringify(p.lv[k] || {}) === JSON.stringify(p.lv[k + 1] || {})) errs.push('rules v2 entry tiers must differ (no no-op upgrade): ' + p.key + ' Lv' + (k + 1) + '->Lv' + (k + 2));
      }
    }
    for (const ok of Object.keys(POOL_OVERLAY)) for (const sid of Object.keys(POOL_OVERLAY[ok])) {
      if (!get(sid | 0)) errs.push('POOL_OVERLAY ' + ok + ' unknown id ' + sid);
      for (const fk of Object.keys(POOL_OVERLAY[ok][sid])) if (POOL_FIELDS.indexOf(fk) < 0) errs.push('POOL_OVERLAY ' + ok + ' id ' + sid + ' field outside POOL_FIELDS: ' + fk);
    }
    for (const ch of Object.keys(CAND_RULES)) for (const r of CAND_RULES[ch]) if ((r.ver | 0) >= 2 && !POOL_OVERLAY[r.overlay]) errs.push('CAND_RULES ' + ch + ' row overlay missing: ' + r.overlay);
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
    return TABLE.filter(p => !(p.rulesFrom > 1)).sort((a, b) => (a.id | 0) - (b.id | 0)).map(p => ({
      id: p.id | 0, key: String(p.key), axis: p.axis, rarity: p.rarity, scope: p.scope,
      modes: { solo: !!(p.modes && p.modes.solo), coop: !!(p.modes && p.modes.coop), duel: !!(p.modes && p.modes.duel) },
      rollable: !!p.rollable, contract: !!p.contract,
      seasons: p.seasons ? { from: p.seasons.from == null ? null : (p.seasons.from | 0), until: p.seasons.until == null ? null : (p.seasons.until | 0) } : null,
    }));
  }
  function poolSig(ver) {
    if ((ver | 0) >= 2) return ('00000000' + _fnv1a(JSON.stringify(_poolEntriesV2())).toString(16)).slice(-8);
    return ('00000000' + _fnv1a(JSON.stringify(poolEntries())).toString(16)).slice(-8);
  }
  const CAND_ALGO_VER = 1;
  function candConstants() {
    return { algo: CAND_ALGO_VER, perkSalt: PERK_SALT, seasonSalt: SEASON_SALT, slots: cfgNum('SLOTS'),
      drawEvery: drawEvery(), gateEvery: gateEvery(), maxDraws: maxDraws(), pityEvery: cfgNum('PITY_EVERY'),
      contractMax: cfgNum('CONTRACT_MAX'), contractMinDraw: cfgNum('CONTRACT_MIN_DRAW'), contractPMilli: cfgNum('CONTRACT_P_MILLI'),
      rarityByBand: RARITY_BY_BAND, rarityGate: RARITY_GATE };
  }
  function candSig(ver, overlayKey) {
    if ((ver | 0) >= 2) return ('00000000' + _fnv1a(JSON.stringify({ pool: _poolEntriesV2(), cand: _candConstantsV2(overlayKey || V2_DEFAULT_OVERLAY) })).toString(16)).slice(-8);
    return ('00000000' + _fnv1a(JSON.stringify({ pool: poolEntries(), cand: candConstants() })).toString(16)).slice(-8);
  }
  const CAND_RULES = Object.freeze({
    ea: Object.freeze([Object.freeze({ fromSeason: 0, ver: 2, overlay: 'ea0' })]),
    playtest: Object.freeze([Object.freeze({ fromSeason: 0, ver: 1 })]),
    demo: Object.freeze([Object.freeze({ fromSeason: 0, ver: 1 })]),
  });
  const V1_ROW = CAND_RULES.playtest[0];
  const V2_DEFAULT_OVERLAY = 'ea0';
  function rulesRow(channel, seasonId) {
    const rows = (typeof channel === 'string' && Object.prototype.hasOwnProperty.call(CAND_RULES, channel)) ? CAND_RULES[channel] : null;
    if (!rows) return V1_ROW;
    const s = Math.max(0, seasonId | 0);
    let row = rows[0];
    for (const r of rows) if (s >= (r.fromSeason | 0)) row = r;
    return row;
  }
  function rulesVer(channel, seasonId) { return rulesRow(channel, seasonId).ver | 0; }
  const CAND_PICK_SALT = 0x91C4, CAND_N = 3;
  function candIdx(runSeed, depth) {
    const R = window.RNG;
    return Math.min(CAND_N - 1, Math.floor(window.makeRNG(R.deriveSeed(R.deriveSeed(runSeed | 0, CAND_PICK_SALT), depth | 0))() * CAND_N));
  }
  function poolEntriesFor(ver) { return ((ver | 0) >= 2) ? _poolEntriesV2() : poolEntries(); }
  function candConstantsFor(ver, overlayKey) { return ((ver | 0) >= 2) ? _candConstantsV2(overlayKey || V2_DEFAULT_OVERLAY) : candConstants(); }
  function candSigOfRow(row) { return candSig((row && row.ver) | 0, row && row.overlay); }
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
    if (rulesVer(opts && opts.channel, opts && opts.seasonId) >= 2) return _candidatesV2(sSeed, depth, build, drawIdx, skipBank, opts);
    return _candidatesV1(sSeed, depth, build, drawIdx, skipBank, opts);
  }
  function _candidatesV1(sSeed, depth, build, drawIdx, skipBank, opts) {
    const mode = (opts && opts.mode) || 'solo';
    const sid = (opts && opts.seasonId != null) ? (opts.seasonId | 0) : 0;
    const rng = window.makeRNG(drawSeed(sSeed, depth, build));
    const slots = unpackBuild(build);
    const held = slots.filter(Boolean);
    const heldIds = new Set(held.map(s => s.id));
    const heldAxes = new Set(held.map(s => get(s.id) && get(s.id).axis));
    const poolAll = TABLE.filter(p => p.rollable && p.modes && p.modes[mode] && inSeason(p, sid) && !(p.rulesFrom > 1));
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
    if (rulesVer(opts && opts.channel, opts && opts.seasonId) >= 2) return _walkV2(sSeed, picksArr, k, opts, false).contractsSeen;
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
  function restoreRun(E, build, picksArr, drawIdx, rerolls) {
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
    if (rerolls !== undefined) {
      const MPn = window.MODIFIER_PLAN;
      const map = {};
      if (rerolls && typeof rerolls === 'object') for (const k of Object.keys(rerolls)) if ((rerolls[k] | 0) === 1 && (!MPn || !MPn.isRerollTarget || MPn.isRerollTarget(k | 0))) map[k | 0] = 1;
      E.affixRerolls = map;
    }
    return true;
  }
  function replay(sSeed, picksArr, endDepth, opts) {
    if (rulesVer(opts && opts.channel, opts && opts.seasonId) >= 2) {
      const n2 = picksCount(picksArr);
      if (n2 < 0) return { ok: false, why: 'picks-shape', rv: 2 };
      if (n2 > maxDrawsByDepth(endDepth)) return { ok: false, why: 'picks-count', at: n2, rv: 2 };
      const w = _walkV2(sSeed, picksArr, n2, opts, true);
      if (!w.ok) return { ok: false, why: w.why, at: w.at, rv: 2 };
      return { ok: true, build: w.build >>> 0, n: n2, skipBank: w.skipBank, contractsSeen: w.contractsSeen, rv: 2 };
    }
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
  function drawCtxAt(sSeed, picksArr, k, opts) {
    if (rulesVer(opts && opts.channel, opts && opts.seasonId) >= 2) {
      const w = _walkV2(sSeed, picksArr, k, opts, false);
      return { build: w.build >>> 0, skipBank: w.skipBank | 0, contractsSeen: w.contractsSeen | 0, prevShown: w.prevShown.slice(), rv: 2 };
    }
    const mode = (opts && opts.mode) || 'solo';
    const seasonId = (opts && opts.seasonId != null) ? (opts.seasonId | 0) : 0;
    let build = 0, skipBank = 0, seen = 0;
    const cnt = picksCount(picksArr);
    const kk = Math.min(k | 0, cnt < 0 ? 0 : cnt);
    for (let j = 0; j < kk; j++) {
      const choice = picksArr[j] | 0;
      const cards = _candidatesV1(sSeed, depthOfDraw(j), build, j, skipBank, { mode, contractsSeen: seen, seasonId });
      if (hasContract(cards)) seen++;
      if (choice === 5) { skipBank = 1; continue; }
      const nb = applyPick(build, cards, choice);
      if (nb == null) break;
      build = nb; skipBank = 0;
    }
    return { build: build >>> 0, skipBank, contractsSeen: seen, prevShown: [], rv: 1 };
  }
  function _walkV2(sSeed, picksArr, kStop, opts, strict) {
    const base = { mode: (opts && opts.mode) || 'solo', seasonId: (opts && opts.seasonId != null) ? (opts.seasonId | 0) : 0,
      channel: opts && opts.channel, runSeed: (opts && opts.runSeed) | 0 };
    let build = 0, skipBank = 0, seen = 0, prevShown = [];
    const arr = Array.isArray(picksArr) ? picksArr : emptyPicks();
    const cnt = picksCount(arr);
    if (cnt < 0) return strict ? { ok: false, why: 'picks-shape' } : { ok: true, build: 0, skipBank: 0, contractsSeen: 0, prevShown: [] };
    const kk = Math.min(kStop | 0, cnt);
    for (let j = 0; j < kk; j++) {
      const choice = arr[j] | 0;
      const cards = _candidatesV2(sSeed, depthOfDraw(j), build, j, skipBank, Object.assign({}, base, { contractsSeen: seen, prevShown }));
      if (hasContract(cards)) seen++;
      if (choice === 5) { prevShown = cards.map(c => c.id); skipBank = 1; continue; }
      if (choice === 4 && !skipBank) { if (strict) return { ok: false, why: 'pick-4-nobank', at: j }; break; }
      const nb = applyPick(build, cards, choice);
      if (nb == null) { if (strict) return { ok: false, why: 'pick-range', at: j }; break; }
      const picked = cards[choice - 1] ? cards[choice - 1].id : 0;
      prevShown = cards.filter(c => c.id !== picked).map(c => c.id);
      build = nb; skipBank = 0;
    }
    return { ok: true, build: build >>> 0, skipBank, contractsSeen: seen, prevShown };
  }
  function effOfBuild(build) {
    const e = { valueMul: {}, clearBonusMul: 1, levelTimeAdd: 0, invGrant: { tnt: 0, freeze: 0 }, strengthBonus: 0, shopMul: 1,
      clover: false, hookSpeedMul: 1, pullSpeedMul: 1, emptyPullMul: 1, freezeDurMul: 1, highlight: 0, slots: heldOf(build),
      cursedMul: 1, comboEvery: 0, comboMul: 1, emptyAmt: 0, emptyCap: 0, midasN: 0, midasValue: 0, drillLv: 0, shatterBonus: 0, laser: 0,
      swingNatMul: 1, hitRadiusMul: 1, mechVeteran: 0, topLit: 0, blind: false, openPullSecs: 0, openPullMul: 1, lightPullW: 0, lightPullMul: 1 };
    for (const c of VALUE_MUL_KEYS) e.valueMul[c] = 1;
    for (const s of e.slots) {
      const p = get(s.id); if (!p) continue;
      const L = p.lv[Math.max(0, Math.min(2, s.lv - 1))] || {};
      for (const f of ['swingNatMul', 'hitRadiusMul', 'mechVeteran', 'topLit', 'blind']) {
        if (L[f] == null) continue;
        const how = FIELD_SPEC[f];
        if (how === 'mul') e[f] = e[f] * L[f];
        else if (how === 'max') e[f] = Math.max(e[f], L[f] | 0);
        else if (how === 'or') e[f] = e[f] || !!L[f];
      }
      if (L.openPull) { e.openPullSecs = +L.openPull.secs; e.openPullMul = +L.openPull.mul; }
      if (L.lightPull) { e.lightPullW = +L.lightPull.wMax; e.lightPullMul = +L.lightPull.mul; }
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
      if (L.emptyPullMul != null) e.emptyPullMul = e.emptyPullMul * L.emptyPullMul;
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
  function clsMulOfBuild(build, cls) {
    let m = 1;
    const ck = CLS_KEYS[cls | 0];
    if (!ck) return m;
    for (const s of heldOf(build)) {
      const p = get(s.id); if (!p) continue;
      const L = p.lv[Math.max(0, Math.min(2, s.lv - 1))] || {};
      if (L.valueMul && L.valueMul[ck] != null) m = m * L.valueMul[ck];
    }
    return m;
  }
  function allMulOfBuild(build) {
    let m = 1;
    for (const s of heldOf(build)) {
      const p = get(s.id); if (!p) continue;
      const L = p.lv[Math.max(0, Math.min(2, s.lv - 1))] || {};
      if (L.valueMul && L.valueMul.all != null) m = m * L.valueMul.all;
    }
    return m;
  }
  function classCapOf(build, cls) {
    if (isEmpty(build)) return 0;
    const ck = CLS_KEYS[cls | 0];
    const v = ck ? CLASS_TOTAL_CAP[ck] : 0;
    return (typeof v === 'number' && v > 0) ? v : 0;
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
  const V2 = Object.freeze({
    CAND_SALT: 0x5A2D,
    SUB: Object.freeze({ A: 0x101, B: 0x102, C: 0x103, X: 0x104, K: 0x105, O: 0x106 }),
    RW: Object.freeze({ common: 10, rare: 5, epic: 2 }),
    BAND_MUL: Object.freeze({ common: Object.freeze([1, 1, 1, 1]), rare: Object.freeze([1, 1.3, 1.6, 2]), epic: Object.freeze([0, 1, 1.5, 2]) }),
    GATE_MUL: Object.freeze({ common: 0.3, rare: 2, epic: 3 }),
    TAG_BIAS: 2, TAG_CAP: 2,
    UP_MUL: 1.5,
    UTIL_DEEP: 0.4,
    MIN_FRESH: 6,
    EPIC_GATE_MIN: 3,
  });
  const TAGS = ['heavy', 'quick', 'blast', 'rhythm', 'class', 'deep', 'cursed', 'time', 'collect', 'team', 'econ', 'freeze'];
  const ROLES = ['steady', 'swing', 'utility'];
  const V2_META = Object.freeze({
    1: { tags: ['time'], role: 'steady' }, 2: { tags: ['time'], role: 'swing' }, 3: { tags: ['class', 'heavy'], role: 'steady' },
    4: { tags: ['class'], role: 'steady' }, 5: { tags: ['blast'], role: 'steady' }, 6: { tags: ['freeze'], role: 'steady' },
    7: { tags: ['heavy'], role: 'steady' }, 8: { tags: ['quick'], role: 'steady' }, 9: { tags: ['class'], role: 'utility' },
    10: { tags: ['collect'], role: 'steady' }, 11: { tags: ['econ'], role: 'steady' }, 12: { tags: ['heavy'], role: 'swing' },
    13: { tags: ['quick'], role: 'utility' }, 14: { tags: ['cursed'], role: 'swing' }, 15: { tags: ['rhythm'], role: 'swing' },
    16: { tags: ['rhythm'], role: 'steady' }, 17: { tags: ['heavy'], role: 'swing' }, 18: { tags: ['time'], role: 'swing' },
    19: { tags: ['quick'], role: 'swing' }, 20: { tags: ['econ'], role: 'swing' },
  });
  const POOL_OVERLAY = Object.freeze({
    ea0: Object.freeze({ 6: Object.freeze({ modes: Object.freeze({ solo: true, coop: true, duel: true }) }), 20: Object.freeze({ rollable: false }) }),
  });
  const POOL_FIELDS = ['rarity', 'rollable', 'modes', 'tags', 'role'];
  function poolFieldOf(p, overlayKey) {
    const m = V2_META[p.id | 0] || {};
    const o = (POOL_OVERLAY[overlayKey || V2_DEFAULT_OVERLAY] || {})[p.id | 0] || {};
    const pick = (k, dflt) => (o[k] !== undefined ? o[k] : (p[k] !== undefined ? p[k] : (m[k] !== undefined ? m[k] : dflt)));
    return { id: p.id | 0, axis: p.axis, rarity: pick('rarity', 'common'), rollable: !!pick('rollable', false), modes: pick('modes', {}), tags: pick('tags', []), role: pick('role', 'steady'),
      contract: !!p.contract, minDepth: p.minDepth | 0, needs: p.needs || null, excl: Array.isArray(p.excl) ? p.excl : [] };
  }
  function _poolEntriesV2() {
    return TABLE.filter(p => !(p.rulesFrom > 2)).sort((a, b) => (a.id | 0) - (b.id | 0)).map(p => {
      const m = V2_META[p.id | 0] || {};
      return { id: p.id | 0, key: String(p.key), axis: p.axis, rarity: p.rarity, scope: p.scope,
        modes: { solo: !!(p.modes && p.modes.solo), coop: !!(p.modes && p.modes.coop), duel: !!(p.modes && p.modes.duel) },
        rollable: !!p.rollable, contract: !!p.contract,
        seasons: p.seasons ? { from: p.seasons.from == null ? null : (p.seasons.from | 0), until: p.seasons.until == null ? null : (p.seasons.until | 0) } : null,
        rulesFrom: p.rulesFrom | 0, tags: (p.tags || m.tags || []).slice(), role: p.role || m.role || 'steady', minDepth: p.minDepth | 0, needs: p.needs || null,
        excl: Array.isArray(p.excl) ? p.excl.slice().sort((a, b) => a - b) : [] };
    });
  }
  function _candConstantsV2(overlayKey) {
    return { algo: 2, perkSalt: PERK_SALT, seasonSalt: SEASON_SALT, candPickSalt: CAND_PICK_SALT, candN: CAND_N, slots: cfgNum('SLOTS'),
      drawEvery: drawEvery(), gateEvery: gateEvery(), maxDraws: maxDraws(), pityEvery: cfgNum('PITY_EVERY'),
      contractMax: cfgNum('CONTRACT_MAX'), contractMinDraw: cfgNum('CONTRACT_MIN_DRAW'), contractPMilli: cfgNum('CONTRACT_P_MILLI'),
      v2: V2, tags: TAGS, roles: ROLES, overlay: POOL_OVERLAY[overlayKey] || null };
  }
  function sameTier(id, lv) {
    const p = get(id);
    if (!p || lv < 1 || lv >= 3) return false;
    return JSON.stringify(p.lv[lv - 1] || {}) === JSON.stringify(p.lv[lv] || {});
  }
  function _wPick(rng, items, wOf) {
    let tot = 0;
    const ws = items.map(it => { const w = wOf(it); const v = (w > 0 && isFinite(w)) ? w : 0; tot += v; return v; });
    if (!(tot > 0)) return null;
    let x = rng() * tot;
    for (let i = 0; i < items.length; i++) { if (ws[i] <= 0) continue; x -= ws[i]; if (x < 0) return items[i]; }
    for (let i = items.length - 1; i >= 0; i--) if (ws[i] > 0) return items[i];
    return null;
  }
  function _soft(list, preds) {
    let cur = list;
    for (const f of preds) { if (!f) continue; const nx = cur.filter(f); if (nx.length) cur = nx; }
    return cur;
  }
  const _RIX = { common: 0, rare: 1, epic: 2 };
  function _candidatesV2(sSeed, depth, build, drawIdx, skipBank, opts) {
    const mode = (opts && opts.mode) || 'solo';
    const sid = (opts && opts.seasonId != null) ? (opts.seasonId | 0) : 0;
    const row = rulesRow(opts && opts.channel, sid);
    const ov = row.overlay || V2_DEFAULT_OVERLAY;
    const d = Math.max(0, depth | 0), k = drawIdx | 0;
    const R = window.RNG;
    const base = R.deriveSeed(drawSeed(sSeed, d, build), V2.CAND_SALT + candIdx((opts && opts.runSeed) | 0, d));
    const sub = (s) => window.makeRNG(R.deriveSeed(base, s));
    const rA = sub(V2.SUB.A), rB = sub(V2.SUB.B), rC = sub(V2.SUB.C), rX = sub(V2.SUB.X), rK = sub(V2.SUB.K), rO = sub(V2.SUB.O);
    const slots = unpackBuild(build);
    const held = slots.filter(Boolean);
    const heldIds = new Set(held.map(s => s.id));
    const fOf = new Map();
    const F = (p) => { let f = fOf.get(p.id); if (!f) { f = poolFieldOf(p, ov); fOf.set(p.id, f); } return f; };
    const heldF = held.map(s => get(s.id)).filter(Boolean).map(F);
    const heldAxes = new Set(heldF.map(f => f.axis));
    const tagShare = (f) => Math.min(V2.TAG_CAP, heldF.filter(h => h.tags.some(t => f.tags.indexOf(t) >= 0)).length);
    const exclHit = (f) => f.excl.some(x => heldIds.has(x)) || heldF.some(h => h.excl.indexOf(f.id) >= 0);
    const band = Math.min(3, Math.floor(d / gateEvery()));
    const gate = k > 0 && isGateDepth(d);
    const pityN = (cfg().PITY_EVERY | 0) || FALLBACK.PITY_EVERY;
    const pity = k > 0 && !gate && (k % pityN) === pityN - 1;
    const poolAll = TABLE.filter(p => {
      if (p.rulesFrom > row.ver) return false;
      const f = F(p);
      return f.rollable && f.modes && f.modes[mode] && inSeason(p, sid) && f.minDepth <= d && (!f.needs || (f.needs === 'coop2' && mode === 'coop'));
    });
    const wNew = (p) => {
      const f = F(p), r = f.rarity;
      return (V2.RW[r] || 0) * ((V2.BAND_MUL[r] || [])[band] || 0) * (gate ? (V2.GATE_MUL[r] || 0) : 1) * (1 + V2.TAG_BIAS * tagShare(f)) * (f.role === 'utility' && band >= 2 ? V2.UTIL_DEEP : 1);
    };
    let pool = poolAll.filter(p => !F(p).contract && !heldIds.has(p.id) && !exclHit(F(p)) && wNew(p) > 0);
    const prev = (opts && Array.isArray(opts.prevShown)) ? opts.prevShown : [];
    if (prev.length) { const fresh = pool.filter(p => prev.indexOf(p.id) < 0); if (fresh.length >= V2.MIN_FRESH) pool = fresh; }
    const cPool = poolAll.filter(p => F(p).contract && !heldIds.has(p.id) && !exclHit(F(p)));
    const n = 3 + (skipBank ? 1 : 0);
    const upsAll = held.filter(s => s.lv < 3 && !sameTier(s.id, s.lv)).map(_cardUp);
    const wUp = (c) => (V2.RW[F(get(c.id)).rarity] || 0) * V2.UP_MUL;
    const rOf = (c) => _RIX[F(get(c.id)).rarity] | 0;
    const epicN = pool.filter(p => F(p).rarity === 'epic').length;
    const floorC = (gate && band >= 2 && epicN >= V2.EPIC_GATE_MIN) ? 2 : ((gate || pity) ? 1 : 0);
    const floorB = gate ? 1 : 0;
    const cards = [];
    const used = new Set();
    const take = (c, pos) => { if (!c) return null; c.pos = pos; cards.push(c); used.add(c.id); return c; };
    const left = () => pool.filter(p => !used.has(p.id));
    const leftUps = () => upsAll.filter(c => !used.has(c.id));
    const pickNew = (rng, list, mk) => { const p = _wPick(rng, list, wNew); return p ? mk(p) : null; };
    const rollContract = (mk) => {
      if (!(k >= cfgNum('CONTRACT_MIN_DRAW') && ((opts && opts.contractsSeen) | 0) < cfgNum('CONTRACT_MAX') && cPool.length > 0)) return null;
      if (Math.floor(rK() * 1000) >= cfgNum('CONTRACT_P_MILLI')) return null;
      const p = cPool[Math.floor(rK() * cPool.length)];
      return mk(p);
    };
    const roleOf = (c) => F(get(c.id)).role, axisOf = (c) => get(c.id).axis;
    if (held.length < 3) {
      const free = _firstEmpty(slots);
      const mkNew = (p) => _cardNew(p, free);
      const contA = left().filter(p => heldAxes.has(p.axis) || tagShare(F(p)) > 0);
      const aItems = leftUps().map(c => ({ up: c })).concat(contA.map(p => ({ p })));
      const aPick = _wPick(rA, aItems, (it) => (it.up ? wUp(it.up) : wNew(it.p)));
      if (aPick) take(aPick.up ? aPick.up : mkNew(aPick.p), 'A');
      else take(pickNew(rA, left(), mkNew), 'A');
      const aAx = cards.length ? axisOf(cards[0]) : null;
      const bBase = _soft(left(), [floorB ? (p => _RIX[F(p).rarity] >= floorB) : null]);
      const axes = [];
      for (const p of bBase) if (!heldAxes.has(p.axis) && p.axis !== aAx && axes.indexOf(p.axis) < 0) axes.push(p.axis);
      axes.sort((x, y) => AXES.indexOf(x) - AXES.indexOf(y));
      let b = null;
      if (axes.length) { const ax = axes[Math.floor(rB() * axes.length)]; b = pickNew(rB, bBase.filter(p => p.axis === ax), mkNew); }
      if (!b) {
        const bItems = bBase.map(p => ({ p })).concat(leftUps().map(c => ({ up: c })));
        const bp = _wPick(rB, bItems, (it) => (it.up ? wUp(it.up) : wNew(it.p)));
        b = bp ? (bp.up ? bp.up : mkNew(bp.p)) : null;
      }
      take(b, 'B');
      const cc = rollContract(mkNew);
      if (cc) take(cc, 'C');
      else if (cards.length < n) {
        const sameRole = cards.length >= 2 && roleOf(cards[0]) === roleOf(cards[1]) ? roleOf(cards[0]) : null;
        const axSet = cards.map(axisOf);
        const cItems = left().map(p => ({ p, f: F(p) })).concat(leftUps().map(c => ({ up: c, f: F(get(c.id)) })));
        const cList = _soft(cItems, [floorC ? (it => _RIX[it.f.rarity] >= floorC) : null, sameRole ? (it => it.f.role !== sameRole) : null, (it => axSet.indexOf(it.f.axis) < 0)]);
        const cp = _wPick(rC, cList, (it) => (it.up ? wUp(it.up) : wNew(it.p)));
        if (cp) take(cp.up ? cp.up : mkNew(cp.p), 'C');
      }
      while (cards.length < n) {
        const xItems = left().map(p => ({ p })).concat(leftUps().map(c => ({ up: c })));
        const xp = _wPick(rX, xItems, (it) => (it.up ? wUp(it.up) : wNew(it.p)));
        if (!xp) break;
        take(xp.up ? xp.up : mkNew(xp.p), cards.length >= 3 ? 'X' : 'C');
      }
    } else {
      const order = [0, 1, 2].filter(s => slots[s]).sort((x, y) => (slots[x].lv - slots[y].lv) || (x - y));
      const targeted = [];
      const nextTarget = (pref) => {
        if (pref != null && targeted.indexOf(pref) < 0) { targeted.push(pref); return pref; }
        for (const s of order) if (targeted.indexOf(s) < 0) { targeted.push(s); return s; }
        return order[0];
      };
      const sameAxisSlot = (p) => { for (const s of order) if (targeted.indexOf(s) < 0 && get(slots[s].id) && get(slots[s].id).axis === p.axis) return s; return null; };
      const ups = leftUps();
      const u = _wPick(rA, ups, wUp);
      if (u) take(u, 'A');
      const bBase = _soft(left(), [floorB ? (p => _RIX[F(p).rarity] >= floorB) : null]);
      const t1 = nextTarget(null);
      const rb = pickNew(rB, bBase, (p) => _cardReplace(p, t1));
      if (rb) take(rb, u ? 'B' : 'A');
      if (!u) {
        const p2 = _wPick(rA, _soft(left(), [floorB ? (p => _RIX[F(p).rarity] >= floorB) : null]), wNew);
        if (p2) take(_cardReplace(p2, nextTarget(sameAxisSlot(p2))), 'B');
      }
      const cc = rollContract((p) => _cardReplace(p, nextTarget(sameAxisSlot(p))));
      if (cc) take(cc, 'C');
      else if (cards.length < n) {
        const sameRole = cards.length >= 2 && roleOf(cards[0]) === roleOf(cards[1]) ? roleOf(cards[0]) : null;
        const axSet = cards.map(axisOf);
        const cList = _soft(left(), [floorC ? (p => _RIX[F(p).rarity] >= floorC) : null, sameRole ? (p => F(p).role !== sameRole) : null, (p => axSet.indexOf(p.axis) < 0)]);
        const cp = _wPick(rC, cList, wNew);
        if (cp) take(_cardReplace(cp, nextTarget(sameAxisSlot(cp))), 'C');
      }
      while (cards.length < n) {
        const xp = _wPick(rX, left(), wNew);
        if (!xp) break;
        take(_cardReplace(xp, nextTarget(sameAxisSlot(xp))), cards.length >= 3 ? 'X' : 'C');
      }
    }
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(rO() * (i + 1)); const t = cards[i]; cards[i] = cards[j]; cards[j] = t; }
    return cards;
  }
  return {
    CAND_RULES, rulesRow, rulesVer, candIdx, drawCtxAt, poolEntriesFor, candConstantsFor, candSigOfRow,
    V2, TAGS, ROLES, V2_META, POOL_OVERLAY, poolFieldOf, sameTier,
    PERK_SALT, SEASON_SALT, CLS, CLS_KEYS, ITEM_CLS, T1_FIELDS, RENDER_ONLY, VALUE_MUL_KEYS, INV_KEYS, FLAG_KEYS, AXES, RARITIES, SCOPES,
    RARITY_BY_BAND, RARITY_GATE, FALLBACK,
    cfg, get, list, validateTable, clsOfItem, clsOfCreature,
    packBuild, unpackBuild, heldOf, isEmpty, buildValid,
    emptyPicks, packPicks, unpackPicks, picksCount,
    drawEvery, gateEvery, maxDraws, drawIdxAt, depthOfDraw, isGateDepth, maxDrawsByDepth,
    seasonSeed, drawSeed, candidates, applyPick, replay, pickApply, restoreRun,
    cfgNum, isContract, hasContract, contractsSeenBefore, SUB_KEYS, ONE_PER_TABLE,
    inSeason, poolEntries, poolSig,
    candConstants, candSig, CAND_ALGO_VER,
    effOfBuild, valueMulOfBuild, buildOf, effOf, valueMulOf, levelTimeAddMax, NEUTRAL,
    CLASS_TOTAL_CAP, CURSED_FLIP_MIN, clsMulOfBuild, allMulOfBuild, classCapOf,
    nameKey, descKey, descParams, iconOf, rarityOf,
    _setTableForTest(list) { TABLE = list || LIST; _index(); _effCache = { build: -1, eff: effOfBuild(0) }; },
  };
})();
