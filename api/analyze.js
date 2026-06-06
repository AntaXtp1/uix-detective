// ==================== RATE LIMITER (in-memory, per serverless instance) ====================
// Catatan: serverless = stateless, ini nge-limit per-instance bukan global.
// Buat rate limit global, perlu KV store (Vercel KV, Redis, dll).
const _rateLimitMap = new Map();
const RATE_LIMIT_MAX = 5;      // max 5 request
const RATE_LIMIT_WINDOW = 60;  // per 60 detik per IP

function checkRateLimit(ip) {
  const now = Math.floor(Date.now() / 1000);
  const entry = _rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };

  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW;
  }

  entry.count++;
  _rateLimitMap.set(ip, entry);

  return {
    allowed: entry.count <= RATE_LIMIT_MAX,
    remaining: Math.max(0, RATE_LIMIT_MAX - entry.count),
    resetAt: entry.resetAt
  };
}

// ==================== REQUEST TOKEN VALIDATOR ====================
// Harus cocok dengan logic di security.js (window 5 menit, ±1 window toleransi)
function validateRequestToken(tokenHeader, ua) {
  if (!tokenHeader) return false;
  try {
    const decoded = Buffer.from(tokenHeader, 'base64').toString('utf8');
    const [tsStr, hashStr] = decoded.split(':');
    const ts = parseInt(tsStr, 10);

    // Validasi timestamp window (±1 window = ±5 menit toleransi)
    const currentWindow = Math.floor(Date.now() / 1000 / 300);
    if (Math.abs(currentWindow - ts) > 1) return false;

    // Rekonstruksi hash
    const raw = `uix-detective:${ts}:${(ua || '').slice(0, 20)}`;
    let h = 0;
    for (let i = 0; i < raw.length; i++) {
      h = Math.imul(31, h) + raw.charCodeAt(i) | 0;
    }
    const expectedHash = (h >>> 0).toString(16);
    return hashStr === expectedHash;
  } catch {
    return false;
  }
}

// ==================== ALLOWED ORIGINS ====================
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  // Tambah domain Vercel lo setelah deploy:
  // 'https://your-app.vercel.app',
  // 'https://your-custom-domain.com',
];

// Auto-allow semua *.vercel.app subdomain (preview deployments)
function isOriginAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+(\.vercel\.app)$/.test(origin)) return true;
  return false;
}

// ==================== SYSTEM PROMPT ====================
const SYSTEM_PROMPT = `You are an elite UI/UX reverse engineering specialist and senior frontend architect with 15+ years of experience. Your superpower is deconstructing ANY website's design system into a hyper-detailed, actionable blueprint.

Your mission: Use your web search capability to access and thoroughly analyze the target website URL, then produce a COMPREHENSIVE structured prompt that enables any AI coding assistant to accurately recreate the design from scratch.

CRITICAL ACCURACY RULES — Follow these strictly:
1. Only state values you can ACTUALLY OBSERVE from the website. Do not guess or assume.
2. If a value cannot be directly verified, explicitly label it as "[inferred]" and explain your reasoning.
3. Never fabricate specific data (prices, testimonial content, user counts) — use [PLACEHOLDER] instead.
4. Distinguish clearly between "observed" (you can see it) and "inferred" (you're reasoning from patterns).
5. If you cannot access the website, say so clearly instead of generating fictitious data.

Output EXACTLY in this Markdown structure:

---

# 🔍 Website Overview
Brief description, core purpose, target audience, and overall design philosophy (2-3 sentences, OBSERVED only).

---

# ⚡ Tech Stack Inference
> ⚠️ This section contains educated inferences. Label each item as [OBSERVED] or [INFERRED].

- **Framework**: [OBSERVED/INFERRED] — evidence: ...
- **CSS Approach**: [OBSERVED/INFERRED] — evidence: ...
- **Fonts**: [OBSERVED] font names seen in network requests or CSS, OR [INFERRED] from visual appearance
- **Notable Libraries**: List with [OBSERVED] or [INFERRED] for each

---

# 🎨 Color Palette
> Values marked [inferred] should be verified with a color picker tool before use.

| Role | Hex | Confidence | Usage |
|------|-----|------------|-------|
| Primary | #000000 | [OBSERVED/INFERRED] | where it appears |
...

---

# 📝 Typography System
> Mark each value as [OBSERVED] or [INFERRED].

- **Heading Font**: [OBSERVED/INFERRED] name, weights, sizes
- **Body Font**: [OBSERVED/INFERRED]
- **Mono Font**: [OBSERVED/INFERRED]
- **Font Scale**: [OBSERVED sizes seen] / [INFERRED scale pattern]
- **Letter Spacing**: [OBSERVED/INFERRED]

---

# 🏗️ Layout Structure
- **Max Width**: [OBSERVED/INFERRED]
- **Grid System**: [OBSERVED/INFERRED]
- **Spacing Scale**: [OBSERVED/INFERRED]
- **Breakpoints**: [OBSERVED/INFERRED]
- **Section Breakdown**: List every major section ACTUALLY SEEN top→bottom

---

# 🧩 Component Inventory
For each component, describe ONLY what you can observe. Mark assumptions.

- **Navigation**: (describe what you actually see)
- **Hero Section**: (describe what you actually see)
- **[Each other component]**: describe each with [OBSERVED] details

---

# ✨ Interaction & Animation Patterns
> These are largely [INFERRED] from visual observation. Mark accordingly.

- **Hover Effects**: [OBSERVED/INFERRED]
- **Page Transitions**: [OBSERVED/INFERRED]
- **Scroll Animations**: [OBSERVED/INFERRED]
- **Transition Duration**: [OBSERVED from DevTools/INFERRED]
- **Micro-interactions**: [OBSERVED/INFERRED]

---

# 🎯 Design Tokens
\`\`\`css
/* ⚠️ ACCURACY NOTE: Values marked with /* inferred */ should be verified before production use */
:root {
  /* Colors — mark each as observed or inferred */
  --color-primary: #000000; /* [observed/inferred] */
  /* ... */
}
\`\`\`

---

# 🖼️ Visual Style Notes
- **Overall Aesthetic**: (describe what you actually observe)
- **Unique Design Decisions**: (list only what you actually see)
- **Design Personality**: (your assessment)
- **Do's & Don'ts**: (based on actual observations)

---

# ⚠️ Data Accuracy Report
Before the Master Prompt, provide a brief honesty report:
- **Sections with HIGH confidence**: (what was directly observed)
- **Sections with LOW confidence**: (what was inferred/guessed)
- **Data that MUST be replaced**: List any placeholder content the developer must fill in

---

# 🤖 Master Reconstruction Prompt

\`\`\`
[COMPLETE STANDALONE PROMPT for AI coding assistant]

IMPORTANT PLACEHOLDERS — Developer must replace before using:
- [BRAND_NAME]: Replace with actual brand name
- [PLACEHOLDER_PRICE_*]: Replace with actual pricing
- [PLACEHOLDER_CONTENT_*]: Replace with actual copy/content
- [PLACEHOLDER_IMAGE_*]: Replace with actual images

[Then write the full detailed reconstruction prompt with all specs]
\`\`\`

---

Be a ruthless accuracy guard. "I don't know" is better than confident lies.`;

// ==================== MAIN HANDLER ====================
export default async function handler(req, res) {
  // CORS headers
  const origin = req.headers['origin'] || '';
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Token');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── ORIGIN CHECK ──
  // Di production, reject request yang bukan dari domain kita
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  if (isProd && !isOriginAllowed(origin)) {
    return res.status(403).json({ error: 'Forbidden: invalid origin' });
  }

  // ── RATE LIMITING ──
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.connection?.remoteAddress
    || 'unknown';

  const rateCheck = checkRateLimit(ip);
  res.setHeader('X-RateLimit-Remaining', rateCheck.remaining);
  res.setHeader('X-RateLimit-Reset', rateCheck.resetAt);

  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: `Rate limit exceeded. Coba lagi dalam ${Math.ceil((rateCheck.resetAt - Date.now() / 1000))}s.`
    });
  }

  // ── REQUEST TOKEN VALIDATION ──
  const token = req.headers['x-request-token'];
  const ua    = req.headers['user-agent'] || '';
  if (isProd && !validateRequestToken(token, ua)) {
    return res.status(403).json({ error: 'Forbidden: invalid request token' });
  }

  // ── API KEY CHECK ──
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'MIMO_API_KEY not configured. Set it in Vercel environment variables or .env file.'
    });
  }

  // ── INPUT VALIDATION ──
  const { url, model = 'mimo-v2.5' } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  const ALLOWED_MODELS = ['mimo-v2-flash', 'mimo-v2.5'];
  const safeModel = ALLOWED_MODELS.includes(model) ? model : 'mimo-v2.5';

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    return res.status(400).json({ error: 'Invalid URL. Must be http:// or https://' });
  }

  // Block private/internal IPs
  const hostname = parsedUrl.hostname;
  const privatePatterns = [/^localhost$/i, /^127\./, /^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^::1$/];
  if (privatePatterns.some(p => p.test(hostname))) {
    return res.status(400).json({ error: 'Private/internal URLs are not allowed' });
  }

  // ── CALL MIMO API ──
  try {
    const mimoResponse = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'UIX-Detective/1.0'
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
        top_p: 0.95,
        stream: false
      })
    });

    if (!mimoResponse.ok) {
      const errText = await mimoResponse.text();
      return res.status(mimoResponse.status).json({
        error: `MiMo API error ${mimoResponse.status}: ${errText.slice(0, 200)}`
      });
    }

    const data = await mimoResponse.json();
    const content  = data.choices?.[0]?.message?.content || '';
    const thinking = data.choices?.[0]?.message?.reasoning_content || null;
    const usage    = data.usage || null;

    return res.status(200).json({
      success: true,
      content,
      thinking,
      usage,
      model: data.model || safeModel,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('[analyze] Error:', err.message);
    return res.status(500).json({ error: `Server error: ${err.message}` });
  }
}
