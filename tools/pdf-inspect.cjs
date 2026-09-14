const fs = require('node:fs/promises');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');

async function inspectPDF(buffer, renderPrefix) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
  const pdf = await loading.promise;
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const { items } = await page.getTextContent();
    const links = (await page.getAnnotations()).filter(item => item.subtype === 'Link').map(item => item.url);
    pages.push({ width: page.view[2], height: page.view[3], text: items.map(item => item.str).join(' '), items, links });
    if (renderPrefix) {
      const viewport = page.getViewport({ scale: 1.3 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      await fs.mkdir(path.dirname(renderPrefix), { recursive: true });
      await fs.writeFile(`${renderPrefix}-${number}.png`, canvas.toBuffer('image/png'));
    }
  }
  await loading.destroy();
  return pages;
}
if (require.main === module) {
  fs.readFile(process.argv[2]).then(buffer => inspectPDF(buffer, process.argv[3]))
    .then(pages => console.log(JSON.stringify(pages.map(({width,height,text})=>({width,height,text})), null, 2)));
}
module.exports = { inspectPDF };
