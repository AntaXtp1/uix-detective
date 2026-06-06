// ============================================
//   UIX Detective — Local Dev Server (Streaming)
//   Compatible dengan Cloudflare Pages Functions structure
// ============================================

const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// Load env — coba .env.local dulu, fallback ke .env
function loadEnv() {
  const files = ['.env.local', '.env'];
  for (const f of files) {
    const fp = path.join(__dirname, f);
    if (!fs.existsSync(fp)) continue;
    const lines = fs.readFileSync(fp, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
    console.log(`✅ Env loaded from: ${f}`);
    return;
  }
  console.warn('⚠️  No .env file found');
}
loadEnv();

const PORT    = 3000;
const API_KEY = process.env.MIMO_API_KEY;
const ALLOWED_MODELS = ['mimo-v2-flash', 'mimo-v2.5'];

// ==================== SYSTEM PROMPT (sama kayak Cloudflare function) ====================
const SYSTEM_PROMPT = `You are an elite UI/UX reverse engineering specialist and senior frontend architect with 15+ years of experience. Your superpower is deconstructing ANY website's design system into a hyper-detailed, actionable blueprint.

Your mission: Use your web search capability to access and thoroughly analyze the target website URL, then produce a COMPREHENSIVE structured prompt that enables any AI coding assistant to accurately recreate the design from scratch.

CRITICAL ACCURACY RULES — Follow these strictly:
1. Only state values you can ACTUALLY OBSERVE from the website. Do not guess or assume.
2. If a value cannot be directly verified, explicitly label it as "[inferred]" and explain your reasoning.
3. Never fabricate specific data (prices, testimonial content, user counts) — use [PLACEHOLDER] instead.
4. Distinguish clearly between "observed" (you can see it) and "inferred" (you're reasoning from patterns).
5. If you cannot access the website, say so clearly instead of generating fictitious data.

Output EXACTLY in this Markdown structure (with all sections: Website Overview, Tech Stack, Color Palette, Typography, Layout, Components, Interactions, Design Tokens, Visual Notes, Data Accuracy Report, Master Reconstruction Prompt).

Be a ruthless accuracy guard. "I don't know" is better than confident lies.`;

// ==================== MIME TYPES ====================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// ==================== SERVER ====================
const server = http.createServer(async (req, res) => {
  // CORS — dev server, gak perlu strict
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Token');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // ── API endpoint ──
  if (req.url === '/api/analyze' && req.method === 'POST') {
    await handleAnalyze(req, res);
    return;
  }

  // ── Static files ──
  let urlPath = req.url.split('?')[0]; // strip query string
  if (urlPath === '/') urlPath = '/index.html';
  const filePath   = path.join(__dirname, urlPath);
  const ext        = path.extname(filePath);
  const contentType = MIME[ext] || 'text/plain';

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

// ==================== ANALYZE HANDLER (STREAMING) ====================
async function handleAnalyze(req, res) {
  // Collect body
  let rawBody = '';
  for await (const chunk of req) rawBody += chunk;

  let body;
  try { body = JSON.parse(rawBody); }
  catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const { url, model = 'mimo-v2-flash' } = body;
  if (!url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'URL is required' }));
    return;
  }

  if (!API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'MIMO_API_KEY not set in .env file' }));
    return;
  }

  const safeModel = ALLOWED_MODELS.includes(model) ? model : 'mimo-v2-flash';

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid URL' }));
    return;
  }

  console.log(`[analyze] ${safeModel} → ${parsedUrl.hostname}`);

  try {
    // Call MiMo with stream: true
    const mimoRes = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: safeModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Analyze the UI/UX design of this website: ${url}\n\nUse web search to access and thoroughly inspect the website. Be strict about labeling what you observe vs infer. Produce the complete structured blueprint.`
          }
        ],
        max_completion_tokens: 8192,
        temperature: 0.2,
        stream: true,
      }),
    });

    if (!mimoRes.ok) {
      const errText = await mimoRes.text().catch(() => '');
      res.writeHead(mimoRes.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `MiMo error ${mimoRes.status}: ${errText.slice(0, 200)}` }));
      return;
    }

    // ── Stream SSE langsung ke client ──
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const reader = mimoRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Pastiin ada [DONE] signal
          res.write('data: [DONE]\n\n');
          res.end();
          break;
        }
        res.write(value); // Forward raw SSE chunk
      }
    } catch (streamErr) {
      console.error('[stream] Error:', streamErr.message);
      res.write(`data: {"error":"${streamErr.message}"}\n\n`);
      res.end();
    }

  } catch (err) {
    console.error('[analyze] Error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
}

// ==================== START ──  ====================
server.listen(PORT, () => {
  const apiStatus = API_KEY ? '✅ Loaded' : '❌ MISSING — set MIMO_API_KEY in .env';
  console.log(`
🕵️  UIX Detective — Local Dev Server (Streaming Mode)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 Open:    http://localhost:${PORT}
🔑 API Key: ${apiStatus}
📡 Mode:    Streaming SSE (sama kayak Cloudflare)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ctrl+C buat stop server
`);
  if (!API_KEY) {
    console.warn('⚠️  Tambah MIMO_API_KEY=your_key_here ke file .env\n');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} udah dipake. Kill dulu proses yang jalan atau ganti port.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
