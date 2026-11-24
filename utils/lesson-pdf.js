'use strict';

const { chromium, errors } = require('playwright-core');

function createPdfRenderer() {
  let browser;

  return {
    async render({ course, title, source, content }) {
      const html = typeof content?.highlightedText === 'string' ? content.highlightedText.trim() : '';
      const text = typeof content?.text === 'string' ? content.text.trim() : '';
      if (!html && !text) return null;

      browser ??= launchBrowser();
      const page = await (await browser).newPage({ javaScriptEnabled: false });
      try {
        await page.setContent(printDocument(course, title, source));
        const hasContent = await page.locator('article').evaluate((article, { html, text }) => {
          const template = document.createElement('template');
          template.innerHTML = html;
          template.content.querySelectorAll('script, style, link, meta, base, iframe, object, embed')
            .forEach((element) => element.remove());
          if (template.content.textContent.trim() || template.content.querySelector('img')) {
            for (const image of template.content.querySelectorAll('img')) image.loading = 'eager';
            article.append(template.content);
            return true;
          }
          article.classList.add('plain-text');
          article.textContent = text;
          return Boolean(text);
        }, { html, text });
        if (!hasContent) return null;

        try {
          await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), null, {
            timeout: 10000
          });
        } catch (error) {
          if (!(error instanceof errors.TimeoutError)) throw error;
        }

        return await page.pdf({ preferCSSPageSize: true, printBackground: true });
      } finally {
        await page.close();
      }
    },

    async close() {
      if (browser) await browser.then((instance) => instance.close(), () => {});
    }
  };
}

async function launchBrowser() {
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      return await chromium.launch({ channel, timeout: 15000 });
    } catch {
      // Try the next supported browser installation.
    }
  }
  throw new Error('Para gerar PDFs, instale Chrome ou Edge, ou execute npx playwright-core install chromium.');
}

function printDocument(course, title, source) {
  const origin = new URL(source).origin;
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri ${origin}; form-action 'none'">
  <base href="${escapeHtml(source)}">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 17mm 18mm; }
    body { margin: 0; color: #20242a; font: 11pt/1.55 Arial, sans-serif; overflow-wrap: anywhere; }
    header { border-bottom: 1px solid #d4d9e0; padding-bottom: 9pt; margin-bottom: 16pt; break-after: avoid; }
    header p { margin: 0 0 5pt; color: #505965; font-size: 10pt; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; break-after: avoid; }
    h1 { margin: 0; font-size: 20pt; }
    h2 { font-size: 15pt; }
    p, li { orphans: 3; widows: 3; }
    a { color: #174785; }
    code { font-family: Consolas, "Liberation Mono", monospace; font-size: 0.9em; }
    pre { padding: 9pt; background: #f1f4f7; border-radius: 4pt; }
    pre, .plain-text { white-space: pre-wrap; }
    blockquote { margin: 12pt 0; padding: 0 0 0 10pt; border-left: 3pt solid #bcc8d5; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d4d9e0; padding: 4pt 6pt; }
    tr, figure { break-inside: avoid; }
    img { max-width: 100%; max-height: 220mm; height: auto; object-fit: contain; }
  </style>
</head>
<body>
  <header><p>${escapeHtml(course)}</p><h1>${escapeHtml(title)}</h1></header>
  <article></article>
</body>
</html>`;
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

module.exports = { createPdfRenderer };
