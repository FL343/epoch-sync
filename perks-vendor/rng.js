// generated file: comments stripped from the client-side source; regenerate with the companion repo's scripts/gen-perks-vendor.js (byte-locked there)
(function () {
  function makeRNG(seed) {
    let s = (seed | 0) || 1;
    function next() {
      s = (s + 0x6D2B79F5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    next.int = function (n) { return Math.floor(next() * n); };
    next.range = function (a, b) { return a + next() * (b - a); };
    next.pick = function (arr) { return arr[Math.floor(next() * arr.length)]; };
    next.chance = function (p) { return next() < p; };
    next.shuffle = function (arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    return next;
  }
  function encodeSeed(seed) {
    return Math.abs(seed | 0).toString(36).padStart(6, '0').toUpperCase().slice(0, 6);
  }
  function decodeSeed(str) {
    return parseInt((str || '').toLowerCase(), 36) || 0;
  }
  function deriveSeed(parent, salt) {
    let x = ((parent ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0);
    x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B);
    x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35);
    return (x ^ (x >>> 16)) >>> 0;
  }
  function dailySeed() {
    const now = new Date();
    return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  }
  window.makeRNG = makeRNG;
  window.RNG = { makeRNG, encodeSeed, decodeSeed, deriveSeed, dailySeed };
})();
