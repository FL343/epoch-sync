'use strict';
// Strict license reading of ISteamUser/CheckAppOwnership (v4), shared by the inventory keepsakes job (grants.js) and the
// classic-owner lane of the reconcile job (classic.js). One predicate, one test vector set (test/ownership.js):
//   owned = the player bought it himself and still has it: ownsapp + permanent, not a site license, not cancelled by the
//   user, and the license belongs to this account (family sharing reports the lender as ownersteamid).
// Free weekends, family sharing, site licenses and cancelled licenses are all "not owned" here.

function ownsStrict(json, sid) {
  const a = json && json.appownership;
  if (!a || a.ownsapp !== true || a.permanent !== true) return false;
  if (a.sitelicense === true || a.usercanceled === true) return false;
  return String(a.ownersteamid) === String(sid);
}

// -> the license start (ms) when ownsStrict; else null (also null when the timestamp does not parse).
function ownLicenseMs(json, sid) {
  if (!ownsStrict(json, sid)) return null;
  const t = Date.parse(json.appownership.timestamp);
  return isFinite(t) && t > 0 ? t : null;
}

// A definite answer at all? (HTTP 200 with an appownership object that says yes or no.) Anything else = unknown.
function definite(json) {
  const a = json && json.appownership;
  return !!(a && typeof a === 'object' && typeof a.ownsapp === 'boolean');
}

module.exports = { ownsStrict, ownLicenseMs, definite };
