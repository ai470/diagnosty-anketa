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
  'forecastFV', 'forecastPct', 'forecastNeed'
];

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }

  var data = JSON.parse(e.postData.contents);
  var row = HEADERS.map(function (key) {
    return data[key] !== undefined ? data[key] : '';
  });
  sheet.appendRow(row);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
