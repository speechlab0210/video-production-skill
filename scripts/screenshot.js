/**
 * Slide Screenshot Script (Playwright)
 * 
 * Takes screenshots of HTML slides at the configured resolution.
 * Automatically detects slide count from the slides/ directory.
 * 
 * Usage: node screenshot.js [project_dir]
 *   - project_dir: directory containing slides/slide_XX.html (default: CWD)
 * 
 * Optional config.json in project_dir:
 *   { "video": { "width": 1920, "height": 1080 } }
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// --- Resolve project directory ---
const PROJECT_DIR = path.resolve(process.argv[2] || process.cwd());

// --- Load config ---
const CONFIG_PATH = path.join(PROJECT_DIR, 'config.json');
const config = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};

const WIDTH = config.video?.width || 1920;
const HEIGHT = config.video?.height || 1080;
const SLIDES_DIR = path.join(PROJECT_DIR, 'slides');

// --- Auto-detect slides ---
if (!fs.existsSync(SLIDES_DIR)) { console.error(`ERROR: slides/ not found in ${PROJECT_DIR}`); process.exit(1); }

const htmlFiles = fs.readdirSync(SLIDES_DIR)
  .filter(f => /^slide_\d+\.html$/i.test(f))
  .sort();

if (htmlFiles.length === 0) { console.error('ERROR: No slide_XX.html files found in slides/'); process.exit(1); }

console.log(`Project: ${PROJECT_DIR}`);
console.log(`Slides: ${htmlFiles.length} | Resolution: ${WIDTH}×${HEIGHT}`);
console.log('---');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  
  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(SLIDES_DIR, htmlFile);
    const pngPath = htmlPath.replace(/\.html$/i, '.png');
    
    const page = await ctx.newPage();
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
    await page.waitForTimeout(500);
    await page.screenshot({ path: pngPath, fullPage: false });
    await page.close();
    
    const baseName = path.basename(pngPath);
    console.log(`✅ ${baseName}`);
  }
  
  await browser.close();
  console.log(`\nAll ${htmlFiles.length} screenshots done!`);
})();
