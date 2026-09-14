const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('Apps Script appends summary columns while retaining historical answers and header order', () => {
  const rows = [];
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    appendRow: row => rows.push(Array.from(row)),
    getRange: (row, column, height, width) => ({
      getValues: () => [rows[row - 1].slice(column - 1, column - 1 + width)],
      setValues: values => values[0].forEach((value, i) => { rows[row - 1][column - 1 + i] = value; })
    })
  };
  const context = vm.createContext({
    SpreadsheetApp: {getActiveSpreadsheet: () => ({getSheetByName: () => sheet})},
    ContentService: {createTextOutput: text => ({setMimeType: () => text}), MimeType: {JSON: 'json'}}
  });
  vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), context);
  const headers = Array.from(context.HEADERS);
  rows.push(headers.slice(0, -3).reverse());
  rows.push(rows[0].map(header => 'old-' + header));
  const history = [...rows[1]];
  const payload = {name: 'Test', summaryA: 'A', summaryB: 'B', recommendedFormat: 'Format'};
  const post = () => context.doPost({postData: {contents: JSON.stringify(payload)}});
  post(); post();
  assert.deepEqual(rows[1], history);
  assert.deepEqual(rows[0].slice(-3), ['summaryA', 'summaryB', 'recommendedFormat']);
  assert.equal(rows[0].length, headers.length);
  for (const [key,value] of Object.entries(payload)) assert.equal(rows[2][rows[0].indexOf(key)], value);
  rows.length = 0;
  post();
  assert.deepEqual(rows[0], headers);
  assert.equal(rows[1][headers.indexOf('recommendedFormat')], 'Format');
});
