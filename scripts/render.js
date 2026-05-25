'use strict';

require('dotenv').config();
const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const { program } = require('commander');
const fs = require('fs');
const path = require('path');

program
  .requiredOption('--template <name>', 'Template name: educator | challenger | quicklist')
  .requiredOption('--input <path>', 'Path to input JSON file')
  .parse(process.argv);

const { template: templateName, input: inputPath } = program.opts();

async function main() {
  const json = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const { id, template, tag, handle, slides } = json;

  if (template !== templateName) {
    console.warn(`Warning: JSON template "${template}" doesn't match --template "${templateName}". Using JSON value.`);
  }

  const outputDir = path.resolve('output', 'posts', id);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Rendering ${slides.length} slides → ${outputDir}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const slideNum = i + 1;

      const tplPath = path.resolve('templates', template, `${slide.type}.html`);
      if (!fs.existsSync(tplPath)) {
        throw new Error(`Template not found: ${tplPath}`);
      }

      const tplSrc = fs.readFileSync(tplPath, 'utf8');
      const compiled = Handlebars.compile(tplSrc);

      // Root-level globals (tag, handle) merged with per-slide data
      const html = compiled({ tag, handle, ...slide });

      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const filename = `${template}-${slide.type}-${slideNum}.png`;
      const outputPath = path.join(outputDir, filename);
      await page.screenshot({ path: outputPath, fullPage: false });
      await page.close();

      console.log(`  ✓  slide ${slideNum}  [${slide.type}]  →  ${filename}`);
    }
  } finally {
    await browser.close();
  }

  console.log(`\nDone. ${slides.length} PNGs in ${outputDir}`);
}

main().catch(err => {
  console.error('\nRender failed:', err.message);
  process.exit(1);
});
