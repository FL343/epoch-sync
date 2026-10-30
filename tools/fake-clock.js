'use strict';
// ============================================================
// fake-clock.js - move the wall clock seen by Node forward by a number of days (W117, 2026-10-29)
// ============================================================
// Why: tests written against a fixed calendar date ("season 1 starts 12-01", "this record is from 10-27") pass every day
//   until that date and then go red with nobody touching the code. time-bomb.js runs the whole suite with this file
//   preloaded at +3 / +14 / +35 days so such a test shows up days or weeks before it breaks.
// Use:   FAKE_CLOCK_DAYS=14 NODE_OPTIONS='--require "/abs/path/fake-clock.js"' node test/some-test.js
//   Both variables are inherited by child node processes, so a whole test tree (runner + every suite + the processes a suite
//   starts with the default environment) sees the same shifted clock.
// What moves: Date.now(), new Date() with no arguments, and Date() called as a function. Nothing else, on purpose:
//   new Date(<any argument>), Date.parse, Date.UTC, timers, process.hrtime, performance.now, file times, child programs
//   that are not node (git commit dates), Intl formatting without a date, and code run in a new vm context keep the real clock.
// FAKE_CLOCK_DAYS unset / empty / 0 / not a finite number = this file does nothing.
// Node built-ins only, English only: the public reconciliation repo carries a byte copy (tools/fake-clock.js).
(function () {
  const days = Number(process.env.FAKE_CLOCK_DAYS);
  if (!days || !Number.isFinite(days)) return;
  const RealDate = Date;
  if (RealDate.fakeClockDays !== undefined) return;   // loaded twice (NODE_OPTIONS + an explicit --require): shift once
  const OFFSET = Math.round(days * 86400000);
  const realNow = RealDate.now;
  function FakeDate(...args) {
    if (!new.target) return new RealDate(realNow() + OFFSET).toString();   // Date() without new returns a string
    return Reflect.construct(RealDate, args.length ? args : [realNow() + OFFSET], new.target);   // keeps subclasses working
  }
  FakeDate.prototype = RealDate.prototype;            // instanceof Date, Date.prototype methods, JSON: unchanged
  FakeDate.now = function now() { return realNow() + OFFSET; };
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  Object.defineProperty(FakeDate, 'name', { value: 'Date' });
  Object.defineProperty(FakeDate, 'length', { value: 7 });
  Object.defineProperty(FakeDate, 'fakeClockDays', { value: days });
  Object.defineProperty(RealDate.prototype, 'constructor', { value: FakeDate, writable: true, configurable: true });   // d.constructor === Date
  globalThis.Date = FakeDate;
})();
