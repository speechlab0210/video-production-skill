/**
 * TTS + ASR Verification Script
 *
 * Reads narration.json from the project directory, synthesizes each entry
 * via ElevenLabs TTS, and verifies with OpenAI Whisper ASR.
 *
 * Usage: node tts_with_asr.js [project_dir]
 *   - project_dir: directory containing narration.json (default: CWD)
 *
 * Environment variables (or a .env file in the project directory):
 *   ELEVENLABS_API_KEY — ElevenLabs API key
 *   OPENAI_API_KEY     — OpenAI API key (for Whisper)
 *
 * config.json in project_dir (required for voiceId):
 *   { "tts": { "voiceId": "...", "model": "...", "maxRetries": 5,
 *              "stripPunctuation": true },
 *     "asr": { "passThreshold": 0.85, "language": "zh" } }
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// --- Resolve project directory ---
const PROJECT_DIR = path.resolve(process.argv[2] || process.cwd());

// --- Load .env fallback (project dir) ---
try {
  const envPath = path.join(PROJECT_DIR, '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch (e) { /* no .env — fine, env vars may already be set */ }

// --- Load config ---
const CONFIG_PATH = path.join(PROJECT_DIR, 'config.json');
const config = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};

const VOICE_ID = config.tts?.voiceId || process.env.TTS_VOICE_ID;
const MODEL_ID = config.tts?.model || 'eleven_multilingual_v2';
const PASS_THRESHOLD = config.asr?.passThreshold || 0.85;
const MAX_RETRIES = config.tts?.maxRetries || 5;
const STRIP_PUNCT = config.tts?.stripPunctuation !== false; // default true

if (!VOICE_ID || VOICE_ID.startsWith('YOUR_')) {
  console.error('ERROR: set tts.voiceId in config.json (or TTS_VOICE_ID env var).');
  console.error('Any voice from your ElevenLabs voice library works — premade or cloned.');
  process.exit(1);
}
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVENLABS_KEY) { console.error('ERROR: ELEVENLABS_API_KEY env var not set'); process.exit(1); }
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) { console.error('ERROR: OPENAI_API_KEY env var not set'); process.exit(1); }

// --- Load narration ---
const narrationPath = path.join(PROJECT_DIR, 'narration.json');
if (!fs.existsSync(narrationPath)) {
  console.error(`ERROR: narration.json not found in ${PROJECT_DIR}`);
  process.exit(1);
}
const narration = JSON.parse(fs.readFileSync(narrationPath, 'utf8'));

const audioDir = path.join(PROJECT_DIR, 'audio');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

console.log(`Project: ${PROJECT_DIR}`);
console.log(`Slides: ${narration.length} | Voice: ${VOICE_ID} | Threshold: ${PASS_THRESHOLD}`);
console.log('---');

// --- Similarity: character overlap ratio ---
function similarity(a, b) {
  if (!a || !b) return 0;
  const sa = a.replace(/[\s\p{P}]/gu, '');
  const sb = b.replace(/[\s\p{P}]/gu, '');
  if (!sa || !sb) return 0;
  let matches = 0;
  const bChars = sb.split('');
  for (const c of sa) {
    const idx = bChars.indexOf(c);
    if (idx >= 0) { matches++; bChars.splice(idx, 1); }
  }
  return matches / Math.max(sa.length, sb.length);
}

// --- ElevenLabs TTS ---
function synthesize(text, outputPath) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    });
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${VOICE_ID}`,
      method: 'POST',
      headers: { 'Accept': 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': ELEVENLABS_KEY }
    }, res => {
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => reject(new Error(`TTS HTTP ${res.statusCode}: ${body}`)));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { fs.writeFileSync(outputPath, Buffer.concat(chunks)); resolve(); });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// --- OpenAI Whisper ASR ---
async function transcribe(audioPath) {
  const audioData = fs.readFileSync(audioPath);
  const boundary = '----FormBoundary' + Date.now();
  const parts = [];
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`);
  parts.push(audioData);
  parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1`);
  parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${config.asr?.language || 'zh'}`);
  parts.push(`\r\n--${boundary}--\r\n`);

  const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p));

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error(`ASR HTTP ${res.statusCode}: ${data}`)); return; }
        try { resolve(JSON.parse(data).text || ''); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --- Strip ALL punctuation (CJK + Latin) before sending to TTS ---
// Every punctuation mark becomes a pause in Chinese TTS output. Dense commas produce
// machine-gun narration; stripping them lets the voice flow in natural breath groups.
// Subtitles still come from the original punctuated narration.json.
// Disable with config.tts.stripPunctuation = false if your voice behaves differently.
function stripPunctForTTS(text) {
  return text
    .replace(/[。！？，；、：「」『』（）「」《》〈〉【】〔〕｛｝…—–‐~～]/g, ' ')
    .replace(/[.,!?;:"'(){}\[\]‐-―‘-‟…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Process one slide ---
async function processSlide(idx) {
  const num = String(idx + 1).padStart(2, '0');
  const text = narration[idx];
  const ttsText = STRIP_PUNCT ? stripPunctForTTS(text) : text;
  const outPath = path.join(audioDir, `slide_${num}.mp3`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[${num}/${String(narration.length).padStart(2, '0')}] Attempt ${attempt}/${MAX_RETRIES}...`);

    try {
      await synthesize(ttsText, outPath);
      const size = fs.statSync(outPath).size;
      console.log(`  TTS OK: ${Math.round(size / 1024)} KB`);

      console.log(`  ASR verifying...`);
      const transcript = await transcribe(outPath);
      const sim = similarity(text, transcript);
      console.log(`  Similarity: ${(sim * 100).toFixed(1)}%`);

      if (sim >= PASS_THRESHOLD) {
        console.log(`  ✅ PASS`);
        return true;
      } else {
        console.log(`  ❌ FAIL (need ≥${(PASS_THRESHOLD * 100).toFixed(0)}%)`);
        console.log(`  Original: ${text.substring(0, 60)}...`);
        console.log(`  ASR got:  ${transcript.substring(0, 60)}...`);
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }
  }

  console.log(`  ⚠️ Keeping best attempt after ${MAX_RETRIES} tries`);
  return false;
}

// --- Main ---
(async () => {
  console.log(`\nStarting TTS+ASR for ${narration.length} slides\n`);
  let passed = 0, failed = 0;

  for (let i = 0; i < narration.length; i++) {
    const ok = await processSlide(i);
    if (ok) passed++; else failed++;
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Done! Passed: ${passed}, Failed: ${failed}, Total: ${narration.length}`);
  if (failed > 0) console.log(`⚠️ ${failed} slide(s) did not meet ASR threshold — see SKILL.md "verify the words, ship on redundancy" before re-rolling forever.`);
})();
