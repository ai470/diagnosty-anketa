const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const server = require('../tools/serve.cjs');
const { inspectPDF } = require('../tools/pdf-inspect.cjs');
let browser, origin;
const normal = value => value.replace(/\s+/g, ' ').trim();

before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  await fs.mkdir('tmp/pdfs', { recursive: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });

async function questionnaire(viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport, timezoneId: 'America/Los_Angeles' });
  // A completed export needs no third-party connection, including Google Fonts.
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  return page;
}

async function exportPDF(page, name, render = false) {
  const html = await page.evaluate(async () => {
    syncAnketaForPrint();
    const frame = await AnketaPDF.prepareDocument(AnketaPDF.filename(document.querySelector('[data-f="name"]').value, document.querySelector('[data-f="date"]').value));
    const content = '<!doctype html>' + frame.contentDocument.documentElement.outerHTML;
    frame.remove();
    return content;
  });
  const printPage = await browser.newPage();
  await printPage.goto(origin);
  await printPage.setContent(html);
  await printPage.emulateMedia({ media: 'print' });
  await printPage.evaluate(() => document.fonts.ready);
  // Backgrounds must survive the default print preference as well.
  const buffer = await printPage.pdf({ preferCSSPageSize: true, printBackground: false, displayHeaderFooter: false });
  await printPage.close();
  await fs.writeFile(`tmp/pdfs/${name}.pdf`, buffer);
  const pages = await inspectPDF(buffer, render ? `tmp/pdfs/${name}` : null);
  assert.ok(pages.length > 0);
  for (const [index, item] of pages.entries()) {
    assert.ok(Math.abs(item.width - 595.28) < 1 && Math.abs(item.height - 841.89) < 1, 'Every page is A4');
    assert.ok(item.text.length > 70, `Page ${index + 1} is not blank`);
    for (const line of item.items.filter(line => line.str.trim())) {
      assert.ok(line.transform[4] >= 30, `Left overflow on page ${index + 1}: ${line.str}`);
      assert.ok(line.transform[4] + line.width <= item.width - 29, `Right overflow on page ${index + 1}: ${line.str}`);
      assert.ok(line.transform[5] > 8 && line.transform[5] < item.height - 28, `Vertical overflow on page ${index + 1}: ${line.str}`);
    }
  }
  return { pages, text: normal(pages.map(page => page.text).join(' ')), buffer };
}

test('demo: every answer, original visual components, links, embedded Cyrillic and A4 pages', async () => {
  const page = await questionnaire();
  await page.evaluate(() => { fillDemo(); document.querySelector('[data-f="date"]').value = '2026-09-14'; });
  const snapshot = await page.evaluate(() => ({
    values: [...document.querySelectorAll('[data-f]')].filter(el => !['number', 'date'].includes(el.type)).map(el => el.value),
    state: document.querySelector('main').innerHTML
  }));
  const result = await exportPDF(page, 'demo', true);
  assert.ok(result.text.includes('Диагностическая карта финансового пути') && result.text.includes('Монтериум'));
  for (const removed of ['Финансовый путь клиента', 'Кто перед нами', 'Показываем клиенту', 'Заполняйте карту вместе', 'Когда:', 'Открыть курс']) {
    assert.ok(!result.text.includes(removed), `Client PDF contains removed staff copy: ${removed}`);
  }
  for (const answer of snapshot.values) assert.ok(result.text.includes(normal(answer)), `Missing answer: ${answer}`);
  assert.ok(result.text.includes('14.09.2026'), 'Date is independent of timezone');
  for (const heading of ['Знакомство', 'Финансовая ситуация', 'Цели и мотивация', 'Опыт инвестирования', 'Главный барьер', 'Резюме встречи']) assert.ok(result.text.includes(heading));
  assert.ok(result.text.includes('150 000') && result.text.includes('170 000'));
  assert.ok(!result.text.includes('Сохранить анкету') && !result.text.includes('Авто-подсказка'));
  assert.ok(result.buffer.length < 1000000, 'Text PDF, not a full-page raster');
  assert.ok(result.buffer.toString('latin1').includes('/FontFile2'), 'PDF contains embedded fonts');
  assert.ok(result.pages.flatMap(page => page.links).includes('https://fondovyi.monterium-edu.ru/kurs/'), 'Course link is clickable in the PDF');
  assert.equal(await page.locator('main').innerHTML(), snapshot.state, 'Export must not modify the form');
  console.log(`Demo: ${result.pages.length} A4 pages, ${result.buffer.length} bytes`);
  await page.close();
});

test('mobile viewport produces the same printed layout and content', async () => {
  const results = [];
  for (const width of [1440, 390]) {
    const page = await questionnaire({ width, height: 844 });
    await page.evaluate(() => fillDemo());
    results.push(await exportPDF(page, `viewport-${width}`));
    await page.close();
  }
  assert.deepEqual(results[0].pages.map(page => normal(page.text)), results[1].pages.map(page => normal(page.text)));
});

test('spreadsheet example matches automatic rows, strategy and PDF; clearing removes stale results', async () => {
  const page = await questionnaire();
  await page.evaluate(() => {
    fillDemo();
    const values = {date: '2026-09-14', goal: 'На обучение ребёнка через 5 лет', goalSum: '6000000', years: '5', start: '1000000', monthly: '5000'};
    for (const [key,value] of Object.entries(values)) document.querySelector(`[data-f="${key}"]`).value = value;
    syncAnketaForPrint();
  });
  assert.equal(await page.locator('[data-f="rate"]').count(), 0);
  for (const id of ['r-fv','goal-future']) assert.equal(normal(await page.locator('#'+id).textContent()), '4 386 162,50 ₽');
  for (const id of ['g-pct','goal-progress']) assert.equal(await page.locator('#'+id).textContent(), '73,10%');
  const filled = await exportPDF(page, 'spreadsheet-example', true);
  assert.ok(filled.text.includes('4 386 162,50 ₽') && filled.text.includes('73,10%'));
  assert.ok(filled.text.includes('При текущей ситуации цель достигается на'));
  assert.ok(filled.text.includes('Накопится сумма при текущей стратегии'));
  assert.ok(filled.pages.some(p => p.text.includes('Цели и мотивация') && p.text.includes('Проверка стратегии') && p.text.includes('Нужно откладывать')), 'Goal fields and chart fit together on one A4 page');
  // Capture the existing save request locally; never submit a test client to Sheets.
  const payload = await page.evaluate(() => {
    let saved;
    window.fetch = async (_url, options) => { saved = JSON.parse(options.body); return {}; };
    saveAnketa();
    return saved;
  });
  assert.equal(payload.rate, 30);
  assert.equal(normal(payload.forecastFV), '4 386 162,50 ₽');
  assert.equal(payload.forecastPct, '73,10%');
  await page.locator('[data-f="monthly"]').fill('0');
  assert.equal(normal(await page.locator('#r-fv').textContent()), '3 712 930,00 ₽');
  await page.locator('[data-f="years"]').fill('');
  for (const id of ['r-fv', 'r-gap', 'r-need']) assert.equal(await page.locator('#'+id).textContent(), '— ₽');
  assert.equal(await page.locator('#goal-progress').textContent(), '—');
  const result = await exportPDF(page, 'missing-term');
  assert.ok(!result.text.includes('4 386 162') && !result.text.includes('3 712 930'));
  assert.ok(result.text.includes('Накопится при текущей стратегии: —'));
  assert.ok(!result.text.includes('сложный процент') && !result.text.includes('Показываем клиенту'));
  await page.close();
});

test('empty questionnaire and native browser printing have complete field values', async () => {
  const page = await questionnaire();
  const empty = await exportPDF(page, 'empty');
  assert.ok(empty.text.includes('Не указано'));
  assert.ok(!empty.text.includes('Анна Смирнова') && !empty.text.includes('150000'), 'Placeholders are not answers');
  await page.locator('[data-f="name"]').fill('Клиент для прямой печати');
  await page.locator('[data-f="barrier"]').fill('Ответ для Ctrl+P\nПродолжение ответа');
  const buffer = await page.pdf({ preferCSSPageSize: true, printBackground: false });
  const direct = normal((await inspectPDF(buffer)).map(page => page.text).join(' '));
  assert.ok(direct.includes('Клиент для прямой печати'));
  assert.ok(direct.includes('Ответ для Ctrl+P Продолжение ответа'));
  assert.ok(!direct.includes('Сохранить анкету'));
  await page.close();
});

test('long multiline answers and unbroken strings survive page boundaries', async () => {
  const page = await questionnaire();
  const long = Array.from({ length: 90 }, (_, i) => `Строка ${String(i + 1).padStart(3, '0')}: подробный ответ клиента о финансовой ситуации и планах.`).join('\n');
  const token = 'ДлинныйЗапрос'.repeat(65);
  await page.evaluate(({long, token}) => {
    fillDemo();
    document.querySelector('[data-f="pointA"]').value = long;
    document.querySelector('[data-f="summaryA"]').value = long;
    document.querySelector('[data-f="expLevel"]').value = long;
    document.querySelector('[data-f="barrier"]').value = long;
    document.querySelector('[data-f="reason"]').value = token;
    document.querySelector('[data-f="ifDelay"]').value = '<b>Буквальный ответ & символы</b>\nПоследняя строка ответа';
  }, {long, token});
  const result = await exportPDF(page, 'long', true);
  assert.ok(result.text.includes('Последняя строка ответа'));
  assert.ok(result.text.includes('<b>Буквальный ответ & символы</b>'));
  // Initial answer, experience and barrier once; the expert's summary twice.
  for (let i = 1; i <= 90; i++) {
    const marker = `Строка ${String(i).padStart(3, '0')}:`;
    assert.equal(result.text.split(marker).length - 1, 5, `Lost or duplicated line ${i}`);
  }
  assert.ok(result.text.replace(/\s/g, '').includes(token), 'Unbroken input is wrapped without truncation');
  console.log(`Long answers: ${result.pages.length} pages`);
  await page.close();
});

test('zeroes, unchecked choices, and cleared values do not leak old answers or results', async () => {
  const page = await questionnaire();
  await page.evaluate(() => {
    fillDemo();
    ['pointA', 'pointB', 'summaryA', 'summaryB', 'recommendedFormat', 'years', 'goalSum'].forEach(key => document.querySelector(`[data-f="${key}"]`).value = '');
    document.querySelector('[data-f="income"]').value = '0';
    document.querySelector('[data-f="expense"]').value = '0';
    document.querySelector('[data-f="monthly"]').value = '0.125';
    document.querySelectorAll('.pillset .on, .route.on').forEach(el => el.classList.remove('on'));
    document.querySelectorAll('[data-exp]').forEach(el => { el.checked = false; });
  });
  const result = await exportPDF(page, 'cleared');
  assert.ok(!result.text.includes('Есть кредиты и долги'));
  assert.ok(!result.text.includes('Есть капитал и уверенность'));
  assert.ok(result.text.includes('0,125'));
  assert.ok(result.text.includes('Не указано'));
  assert.ok(result.text.includes('Накопится при текущей стратегии: —'));
  const frame = await page.evaluate(async () => {
    const frame = await AnketaPDF.prepareDocument('Проверка');
    return { checked: frame.contentDocument.querySelectorAll('.print-check.checked').length,
      route: frame.contentDocument.querySelectorAll('.route.on').length,
      zero: frame.contentDocument.querySelector('[data-print-field="income"]').textContent };
  });
  assert.deepEqual(frame, { checked: 0, route: 0, zero: '0' });
  await page.close();
});

test('both buttons invoke the print flow; cancellation, duplicate clicks, failure and retry restore controls', async () => {
  const page = await questionnaire();
  // Replaces only the system dialog; all snapshot/font/layout preparation runs.
  await page.addInitScript(() => { window.print = () => { window.__printed = true; }; });
  await page.reload();
  await page.evaluate(() => { fillDemo(); downloadPDF(); downloadPDF(); });
  await page.waitForFunction(() => document.querySelector('.pdf-frame')?.contentWindow.__printed === true);
  assert.equal(await page.locator('.pdf-frame').count(), 1);
  await page.evaluate(() => document.querySelector('.pdf-frame').contentWindow.dispatchEvent(new Event('afterprint')));
  assert.equal(await page.locator('.pdf-frame').count(), 0);
  assert.equal(await page.title(), 'Диагностическая карта финансового пути');
  assert.ok(await page.locator('#pdf-btn').isEnabled());
  // Block only the export document's styles; the already loaded form remains usable.
  await page.route('**/assets/fonts.css', route => route.abort());
  await page.locator('[onclick="downloadPDF()"]').last().click();
  await page.waitForFunction(() => document.querySelector('#pdf-status').getAttribute('role') === 'alert');
  assert.equal(await page.locator('.pdf-frame').count(), 0);
  assert.ok(await page.locator('#pdf-btn').isEnabled());
  await page.unroute('**/assets/fonts.css');
  await page.locator('[onclick="downloadPDF()"]').last().click();
  await page.waitForFunction(() => document.querySelector('.pdf-frame')?.contentWindow.__printed === true);
  await page.close();
});

test('all six route selections and native Ctrl+P keep actual values', async () => {
  const page = await questionnaire();
  const ids = await page.locator('.route').evaluateAll(nodes => nodes.map(node => node.dataset.id));
  assert.equal(ids.length, 6);
  for (const id of ids) {
    await page.locator(`.route[data-id="${id}"]`).click();
    const selected = await page.evaluate(async () => {
      syncAnketaForPrint();
      const frame = await AnketaPDF.prepareDocument('Маршрут');
      const route = frame.contentDocument.querySelector('.route.on');
      const result = {id: route.dataset.id, link: route.querySelector('a').href, count: frame.contentDocument.querySelectorAll('.route.on').length};
      frame.remove();
      return result;
    });
    assert.equal(selected.id, id);
    assert.equal(selected.count, 1);
    assert.ok(selected.link.startsWith('https://'));
  }
  await page.locator('[data-f="name"]').fill('Ольга & <Иванова>');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  assert.equal(await page.locator('[data-print-field="name"]').textContent(), 'Ольга & <Иванова>');
  await page.close();
});

test('expert summary is independent, precedes products, and is exported and saved intact', async () => {
  const page = await questionnaire();
  await page.evaluate(() => fillDemo());
  const values = {summaryA: 'Итог эксперта: текущий бюджет\nУточнение по итогам встречи', summaryB: 'Итоговая цель клиента', recommendedFormat: 'Индивидуальные занятия с экспертом'};
  for (const [key,value] of Object.entries(values)) await page.locator(`[data-f="${key}"]`).fill(value);
  await page.locator('[data-f="pointA"]').fill('Первоначальный ответ клиента');
  await page.locator('.route[data-id="capital"]').click();
  assert.equal(await page.locator('#sum-a').textContent(), values.summaryA);
  assert.equal(await page.locator('#sum-b').textContent(), values.summaryB);
  assert.equal(await page.locator('#sum-route').textContent(), values.recommendedFormat);
  assert.equal(await page.locator('.route .tag').count(), 0);
  assert.deepEqual(await page.locator('.route-link').allTextContents(), Array(6).fill('Ссылка'));
  assert.ok(await page.evaluate(() => !!(document.querySelector('#recommended-format').compareDocumentPosition(document.querySelector('#routes')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  const payload = await page.evaluate(() => {
    let saved;
    window.fetch = async (_url, options) => { saved = JSON.parse(options.body); return {}; };
    saveAnketa(); return saved;
  });
  for (const [key,value] of Object.entries(values)) assert.equal(payload[key], value);
  assert.equal(payload.routeCourse, 'Капитал нового уровня');
  const pdf = await exportPDF(page, 'meeting-summary');
  for (const value of Object.values(values)) assert.ok(pdf.text.includes(normal(value)));
  assert.ok(pdf.text.indexOf('Рекомендуемый формат') < pdf.text.indexOf('Курс «Личный капитал»'));
  assert.ok(pdf.pages.flatMap(p=>p.links).includes('https://kapnovuroveni.monterium-edu.ru/'));
  await page.locator('[data-f="summaryA"]').fill('');
  assert.equal(await page.locator('#sum-a').textContent(), '—');
  await page.close();
});
