/**
 * Node Canvas Slide Generator (no browser needed)
 * 
 * Generates PNG slides from a slides.json definition file.
 * Use this when Playwright/Puppeteer is not available.
 * 
 * Usage: node generate_slides.js [project_dir]
 *   - project_dir: directory containing slides.json (default: CWD)
 * 
 * slides.json format:
 * [
 *   {
 *     "title": "Slide Title",
 *     "subtitle": "Optional subtitle",
 *     "bullets": ["Point 1", "Point 2"],
 *     "icon": "🦞",
 *     "footer": "Source: ..."
 *   },
 *   ...
 * ]
 * 
 * Optional config.json:
 *   { "video": { "width": 1920, "height": 1080 },
 *     "slides": { "bgColor": "#1a0a2e", "accentColor": "#ff4444", "titleSize": 50 } }
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

// --- Resolve project directory ---
const PROJECT_DIR = path.resolve(process.argv[2] || process.cwd());

// --- Load config ---
const CONFIG_PATH = path.join(PROJECT_DIR, 'config.json');
const config = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};

const W = config.video?.width || 1920;
const H = config.video?.height || 1080;
const BG_COLOR = config.slides?.bgColor || '#1a0a2e';
const ACCENT_COLOR = config.slides?.accentColor || '#ff4444';
const TITLE_SIZE = config.slides?.titleSize || 50;
const FONT_FAMILY = config.slides?.fontFamily || '"Microsoft YaHei", "Segoe UI", Arial, sans-serif';

// --- Load slides data ---
const slidesPath = path.join(PROJECT_DIR, 'slides.json');
if (!fs.existsSync(slidesPath)) {
  console.error(`ERROR: slides.json not found in ${PROJECT_DIR}`);
  console.error('Create a slides.json with an array of slide objects. See script header for format.');
  process.exit(1);
}
const slides = JSON.parse(fs.readFileSync(slidesPath, 'utf8'));

// --- Ensure output directory ---
const outputDir = path.join(PROJECT_DIR, 'slides');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

console.log(`Project: ${PROJECT_DIR}`);
console.log(`Slides: ${slides.length} | Resolution: ${W}×${H}`);
console.log('---');

// --- Drawing function ---
function drawSlide(ctx, opts) {
  const {
    bg = BG_COLOR,
    accentColor = ACCENT_COLOR,
    titleSize = TITLE_SIZE,
    title = '',
    subtitle = '',
    bullets = [],
    footer = '',
    icon = ''
  } = opts;

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Accent bar
  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, W, 6);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${titleSize}px ${FONT_FAMILY}`;
  ctx.textAlign = 'left';
  let y = 120;
  const titleText = icon ? `${icon}  ${title}` : title;
  ctx.fillText(titleText, 80, y);

  // Subtitle
  if (subtitle) {
    y += 60;
    ctx.fillStyle = accentColor;
    ctx.font = `bold 32px ${FONT_FAMILY}`;
    ctx.fillText(subtitle, 80, y);
  }

  // Bullets
  if (bullets.length) {
    ctx.fillStyle = '#e0e0e0';
    ctx.font = `28px ${FONT_FAMILY}`;
    y += 60;
    const maxWidth = W - 180;

    for (const b of bullets) {
      if (y > H - 120) break;

      // Header line
      if (b.startsWith('##')) {
        ctx.fillStyle = accentColor;
        ctx.font = `bold 34px ${FONT_FAMILY}`;
        ctx.fillText(b.replace('##', '').trim(), 80, y);
        ctx.fillStyle = '#e0e0e0';
        ctx.font = `28px ${FONT_FAMILY}`;
      } else {
        // Word wrap
        let line = '• ';
        for (const char of b) {
          const test = line + char;
          if (ctx.measureText(test).width > maxWidth) {
            ctx.fillText(line, 100, y);
            y += 40;
            line = '  ' + char;
          } else {
            line = test;
          }
        }
        if (line.trim()) ctx.fillText(line, 100, y);
      }
      y += 45;
    }
  }

  // Footer
  if (footer) {
    ctx.fillStyle = '#666';
    ctx.font = `20px ${FONT_FAMILY}`;
    ctx.fillText(footer, 80, H - 40);
  }
}

// --- Generate slides ---
slides.forEach((slide, i) => {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawSlide(ctx, slide);

  const num = String(i + 1).padStart(2, '0');
  const outPath = path.join(outputDir, `slide_${num}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log(`✅ slide_${num}.png`);
});

console.log(`\nAll ${slides.length} slides generated!`);
