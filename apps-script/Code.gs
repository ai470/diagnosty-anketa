// Google Apps Script — принимает анкету с сайта и дописывает строку в лист "Анкеты"
// текущей Google-таблицы. Разместите этот код через Extensions → Apps Script
// в таблице, которая лежит на корпоративном Google Диске.

var SHEET_NAME = 'Анкеты';

var HEADERS = [
  'timestamp', 'name', 'date', 'expert', 'reason',
  'pointA', 'pointB',
  'income', 'expense', 'freeRest',
  'cushion', 'loans', 'hasInvest', 'storeWhere',
  'goal', 'goalSum', 'years', 'started', 'start', 'monthly', 'rate',
  'experience', 'expLevel', 'improve', 'interest',
  'barrier', 'ifDelay',
  'route', 'routeCourse',
  'forecastFV', 'forecastPct', 'forecastNeed',
  'summaryA', 'summaryB', 'recommendedFormat'
];

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }
  // Append new columns without shifting existing answers or overwriting headers.
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var missing = HEADERS.filter(function (key) { return headers.indexOf(key) === -1; });
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }

  var data = JSON.parse(e.postData.contents);
  var row = headers.map(function (key) {
    return data[key] !== undefined ? data[key] : '';
  });
  sheet.appendRow(row);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
