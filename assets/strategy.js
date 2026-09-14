/* Matches the supplied workbook, including its first month without a deposit.
 * Source: https://docs.google.com/spreadsheets/d/1J6IQbyB4afKsKSn3wM-wPJSed4tXZWYNNFTuTB3QMoE/edit
 * Sheet "Сложный процент ": D7 = 30%, D11 = start,
 * D22 = D21 * (1 + D7) + D5; annual rows repeat every 12 months.
 * F5 = INDEX(D:D, 10 + D3 * 12) / D6. Verified 2026-09-14.
 * This is a local copy of the source model, not a live Sheets connection.
 */
(function (root) {
  'use strict';
  const annualRate = 0.30;
  const maxYears = 20;

  function futureValue(start, monthly, years) {
    let value = start;
    for (let month = 2; month <= years * 12; month++) {
      if (month % 12 === 0) value *= 1 + annualRate;
      value += monthly;
    }
    return value;
  }

  function calculate({ goal, years, start, monthly }) {
    const values = [goal, years, start, monthly];
    if (values.some(value => value === '' || value == null || !Number.isFinite(Number(value)))) return null;
    [goal, years, start, monthly] = values.map(Number);
    if (goal <= 0 || !Number.isInteger(years) || years < 1 || years > maxYears || start < 0 || monthly < 0) return null;
    const fv = futureValue(start, monthly, years);
    const contributionFactor = futureValue(0, 1, years);
    const need = Math.max(0, (goal - futureValue(start, 0, years)) / contributionFactor);
    if (![fv, need, fv / goal].every(Number.isFinite)) return null;
    return { fv, pct: fv / goal, gap: Math.max(0, goal - fv), need };
  }

  const api = Object.freeze({ annualRate, maxYears, calculate });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnketaStrategy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
