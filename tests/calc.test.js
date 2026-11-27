// Ausführen: node tests/calc.test.js
const assert = require('assert');
const C = require('../calc.js');
const S = { wage: 14, deductionPct: 0 };

const e = (d) => ({ d });
let list = [];

// Start: 20 h gearbeitet, 30 h geplant, 40 € online, 10 € bar
list.push(e(C.deltaToTarget(list, { worked: 20, planned: 30, online: 40, cash: 10 })));
let s = C.summary(list, S);
assert.strictEqual(s.payNow, 280);
assert.strictEqual(s.tips, 50);
assert.strictEqual(s.totalNow, 330);
assert.strictEqual(s.tipPerHour, 2.5);
assert.strictEqual(s.totalHours, 50);
assert.strictEqual(s.payMonth, 700);
assert.strictEqual(s.forecastCurrentTips, 750);
assert.strictEqual(s.projectedTips, 125);
assert.strictEqual(s.forecastProjected, 825);

// Schicht: 6 h, 7 € bar, Online-Stand jetzt 52 € -> von Plan abziehen
list.push(e(C.shiftDelta(list, { hours: 6, cash: 7, onlineTotal: 52, fromPlan: true })));
s = C.summary(list, S);
assert.strictEqual(s.worked, 26);
assert.strictEqual(s.planned, 24);
assert.strictEqual(s.online, 52);
assert.strictEqual(s.cash, 17);
assert.strictEqual(s.totalHours, 50);

// Geplant kann nicht negativ werden
const few = [e({ planned: 2 })];
assert.deepStrictEqual(C.shiftDelta(few, { hours: 5, fromPlan: true }), { worked: 5, planned: -2 });

// Abzüge nur auf Lohn
s = C.summary([e({ worked: 10, cash: 5 })], { wage: 14, deductionPct: 10 });
assert.strictEqual(s.payNow, 126);
assert.strictEqual(s.totalNow, 131);

// Keine Stunden -> kein Ø, Hochrechnung = bisheriges TG
s = C.summary([e({ planned: 10, online: 5 })], S);
assert.strictEqual(s.tipPerHour, 0);
assert.strictEqual(s.forecastProjected, 145);

// Zahlen-Parsing
assert.strictEqual(C.parseNum('12,50'), 12.5);
assert.strictEqual(C.parseNum(' 7 € '), 7);
assert.strictEqual(C.parseNum(''), null);
assert.strictEqual(C.parseNum('abc'), null);

// Rundung bei vielen kleinen Beträgen
assert.strictEqual(C.totals([e({ cash: 0.1 }), e({ cash: 0.2 })]).cash, 0.3);

// Stunden:Minuten
assert.strictEqual(C.parseHours('6:30'), 6.5);
assert.strictEqual(C.parseHours('6,30'), 6.5);
assert.strictEqual(C.parseHours('6.45'), 6.75);
assert.strictEqual(C.parseHours('8'), 8);
assert.strictEqual(C.parseHours(':20'), C.rH(1 / 3));
assert.strictEqual(C.parseHours('-1:15'), -1.25);
assert.strictEqual(C.parseHours('6:75'), null);
assert.strictEqual(C.parseHours('abc'), null);
assert.strictEqual(C.parseHours('38.5', true), 38.5); // Automatik: Dezimal als Text
assert.strictEqual(C.parseHours('38:30', true), 38.5);
assert.strictEqual(C.fmtHM(38.5), '38:30');
assert.strictEqual(C.fmtHM(0.75), '0:45');
assert.strictEqual(C.fmtHM(0), '0:00');
// 3 × 20 Minuten = genau 1:00
const thirds = [1, 2, 3].map(() => e({ worked: C.parseHours('0:20') }));
assert.strictEqual(C.fmtHM(C.totals(thirds).worked), '1:00');
assert.strictEqual(C.summary(thirds, S).payNow, 14);

console.log('Alle Tests bestanden ✓');
