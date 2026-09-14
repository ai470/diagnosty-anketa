/* PDF is printed by the browser from the actual questionnaire HTML.
   No canvas, screenshots, external conversion service, or alternate template. */
(function () {
  'use strict';
  let busy = false;
  let currentSession = null;
  const FONT_FACES = [
    '400 15px "Golos Text"', '500 15px "Golos Text"',
    '600 15px "Golos Text"', '700 15px "Golos Text"',
    '500 22px "Cormorant Garamond"', '600 22px "Cormorant Garamond"',
    '700 22px "Cormorant Garamond"'
  ];

  function filename(name, date) {
    const safeName = String(name || 'клиент').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, '_').slice(0, 100).replace(/[. ]+$/g, '') || 'клиент';
    return 'Анкета_' + safeName + (/^\d{4}-\d{2}-\d{2}$/.test(date || '') ? '_' + date : '');
  }

  function fieldValue(field) {
    const value = field.value.trim();
    if (!value) return '—';
    if (field.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('.');
    if (field.type === 'number' && Number.isFinite(Number(value))) {
      return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 20 }).format(Number(value));
    }
    return field.value;
  }

  // Also used by Ctrl+P: values live in properties, not HTML attributes.
  function prepareValues(target, source = target) {
    const originals = [...source.querySelectorAll('[data-f]')];
    target.querySelectorAll('[data-f]').forEach((field, index) => {
      let value = field.nextElementSibling;
      if (!value || !value.classList.contains('print-value')) {
        value = target.createElement('div');
        value.className = 'print-value';
        field.after(value);
      }
      value.textContent = fieldValue(originals[index]);
      value.dataset.printField = field.dataset.f;
    });
    target.querySelectorAll('.pillset').forEach(set => {
      let note = set.nextElementSibling;
      if (!note || !note.classList.contains('print-choice')) {
        note = target.createElement('div');
        note.className = 'print-choice';
        set.after(note);
      }
      note.textContent = set.querySelector('button.on') ? '' : 'Не указано';
    });
  }

  function status(message, error = false) {
    const node = document.getElementById('pdf-status');
    if (!node) return;
    node.setAttribute('role', error ? 'alert' : 'status');
    node.textContent = message;
  }

  function withTimeout(promise, milliseconds) {
    let timeout;
    return Promise.race([promise, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Print resources timed out')), milliseconds);
    })]).finally(() => clearTimeout(timeout));
  }

  async function prepareDocument(title) {
    const frame = document.createElement('iframe');
    frame.className = 'pdf-frame no-print';
    frame.title = 'Анкета для сохранения в PDF';
    frame.setAttribute('aria-hidden', 'true');
    document.body.append(frame);
    try {
      const doc = frame.contentDocument;
      doc.open();
      doc.write('<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body></body></html>');
      doc.close();
      const base = doc.createElement('base');
      base.href = document.baseURI;
      doc.head.append(base);
      doc.title = title;
      const stylesReady = [];
      document.querySelectorAll('head style, head link[rel="stylesheet"]').forEach(original => {
        const style = original.cloneNode(true);
        if (style.tagName === 'LINK') {
          stylesReady.push(new Promise((resolve, reject) => {
            style.onload = resolve;
            style.onerror = () => reject(new Error('Print stylesheet could not load'));
          }));
        }
        doc.head.append(style);
      });
      // Whitelist content roots. Scripts, navigation, modals and save controls
      // never execute or appear in the export document.
      ['.hero', '.wrap', '.site-footer'].forEach(selector => doc.body.append(document.querySelector(selector).cloneNode(true)));
      doc.querySelectorAll('.no-print, .rail, script').forEach(node => node.remove());
      prepareValues(doc, document);
      doc.querySelectorAll('[data-f]').forEach(node => node.remove());
      doc.querySelectorAll('[data-exp]').forEach(node => {
        const original = [...document.querySelectorAll('[data-exp]')].find(item => item.dataset.exp === node.dataset.exp);
        const mark = doc.createElement('span');
        mark.className = 'print-check' + (original.checked ? ' checked' : '');
        mark.setAttribute('aria-label', original.checked ? 'Выбрано' : 'Не выбрано');
        node.closest('.tile').classList.toggle('on', original.checked);
        node.replaceWith(mark);
      });
      doc.querySelectorAll('*').forEach(node => {
        [...node.attributes].filter(attr => attr.name.startsWith('on')).forEach(attr => node.removeAttribute(attr.name));
      });
      // Keep the original palette, typography, SVG gauge and course links.
      // Wait for all weights, including those only used by the print layout.
      await withTimeout((async () => {
        await Promise.all(stylesReady);
        await Promise.all(FONT_FACES.map(face => doc.fonts.load(face, 'Анкета ₽')));
        await doc.fonts.ready;
        if (!FONT_FACES.every(face => doc.fonts.check(face, 'Анкета ₽'))) throw new Error('Print fonts unavailable');
      })(), 20000);
      // A painted layout is required before invoking print in WebKit/Chromium.
      await new Promise(resolve => frame.contentWindow.requestAnimationFrame(() => frame.contentWindow.requestAnimationFrame(resolve)));
      return frame;
    } catch (error) {
      frame.remove();
      throw error;
    }
  }

  async function download() {
    if (busy) return;
    busy = true;
    if (currentSession) currentSession();
    const buttons = [...document.querySelectorAll('[onclick="downloadPDF()"]')];
    const labels = buttons.map(button => button.textContent);
    buttons.forEach(button => { button.disabled = true; button.textContent = 'Готовим PDF…'; });
    status('Готовим анкету к сохранению в PDF…');
    try {
      // Export a snapshot of the current controls, including browser autofill.
      window.syncAnketaForPrint();
      const title = filename(document.querySelector('[data-f="name"]').value, document.querySelector('[data-f="date"]').value);
      const frame = await prepareDocument(title);
      const previousTitle = document.title;
      const previousFocus = document.activeElement;
      const cleanup = () => {
        document.title = previousTitle;
        frame.remove();
        currentSession = null;
        status('');
        if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
      };
      currentSession = cleanup;
      frame.contentWindow.addEventListener('afterprint', cleanup, { once: true });
      // Chromium derives the suggested PDF filename from the top-level title.
      document.title = title;
      status('В окне печати выберите «Сохранить как PDF». Формат — A4.');
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (error) {
      if (currentSession) currentSession();
      console.error('PDF preparation failed:', error);
      status('Не удалось подготовить PDF. Проверьте подключение и нажмите «Скачать PDF» ещё раз.', true);
    } finally {
      busy = false;
      buttons.forEach((button, index) => { button.disabled = false; button.textContent = labels[index]; });
    }
  }

  window.addEventListener('beforeprint', () => {
    window.syncAnketaForPrint();
    prepareValues(document);
  });
  window.AnketaPDF = { download, prepareDocument, filename };
})();
