const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculate } = require('../assets/strategy.js');
const example = { goal: 6000000, years: 5, start: 1000000, monthly: 5000 };

test('matches cached annual source cells D22, D34, D46, D58, D70', () => {
  const source = [1370000, 1857500, 2491250, 3315125, 4386162.5];
  source.forEach((fv, index) => assert.ok(Math.abs(calculate({...example, years: index + 1}).fv - fv) < 0.000001));
  assert.ok(Math.abs(calculate(example).pct - 0.7310270833333333) < 1e-12);
});

test('required monthly amount reaches the goal using the same annual model', () => {
  for (const years of [1, 5, 20]) {
    const result = calculate({...example, years});
    if (result.need > 0) assert.ok(Math.abs(calculate({...example, years, monthly: result.need}).fv - example.goal) < 1e-6);
    else assert.ok(result.fv >= example.goal);
  }
  assert.equal(calculate({...example, start: 6000000, monthly: 0}).need, 0);
  assert.equal(calculate({...example, start: 0, monthly: 0}).fv, 0);
});

test('missing, invalid and unsupported terms do not produce misleading forecasts', () => {
  for (const key of Object.keys(example)) {
    for (const value of ['', undefined, null, NaN, Infinity, -1]) assert.equal(calculate({...example, [key]: value}), null);
  }
  for (const years of [0, 0.5, 1.5, 21]) assert.equal(calculate({...example, years}), null);
  assert.equal(calculate({...example, goal: 0}), null);
});
