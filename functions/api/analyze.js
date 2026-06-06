/**
 * UIX Detective — Cloudflare Pages Function
 * /functions/api/analyze.js → accessible at /api/analyze
 * Streaming SSE response → bypass timeout issues
 */

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

---

# ✨ Interaction & Animation Patterns
> These are largely [INFERRED] from visual observation. Mark accordingly.

---

# 🎯 Design Tokens
\`\`\`css
/* ⚠️ Values marked inferred should be verified before production use */
:root {
  /* mark each as observed or inferred */
}
\`\`\`

---

# 🖼️ Visual Style Notes
- **Overall Aesthetic**: (describe what you actually observe)
- **Unique Design Decisions**: (list only what you actually see)
- **Do's & Don'ts**: (based on actual observations)

---

# ⚠️ Data Accuracy Report
- **Sections with HIGH confidence**: (what was directly observed)
- **Sections with LOW confidence**: (what was inferred/guessed)
- **Data that MUST be replaced**: List any placeholder content

---

# 🤖 Master Reconstruction Prompt

\`\`\`
IMPORTANT PLACEHOLDERS — Developer must replace before using:
- [BRAND_NAME]: Replace with actual brand name
- [PLACEHOLDER_PRICE_*]: Replace with actual pricing
- [PLACEHOLDER_CONTENT_*]: Replace with actual copy/content

[Full detailed reconstruction prompt here]
\`\`\`

---

Be a ruthless accuracy guard. "I don't know" is better than confident lies.`;

const ALLOWED_MODELS = ['mimo-v2-flash', 'mimo-v2.5'];

// ==================== TOKEN VALIDATOR ====================
// Harus cocok dengan logic di security.js
function validateRequestToken(token, ua) {
  if (!token) return false;
  if (token === 'local-dev-bypass') return true;
  try {
    const decoded = atob(token); // Web API — no Buffer needed
    const [tsStr, hashStr] = decoded.split(':');
    const ts = parseInt(tsStr, 10);
    const currentWindow = Math.floor(Date.now() / 1000 / 300);
    if (Math.abs(currentWindow - ts) > 1) return false;
    const raw = `uix-detective:${ts}:${(ua || '').slice(0, 20)}`;
    let h = 0;
    for (let i = 0; i < raw.length; i++) {
      h = Math.imul(31, h) + raw.charCodeAt(i) | 0;
    }
    return hashStr === (h >>> 0).toString(16);
  } catch {
    return false;
  }
}

// ==================== ORIGIN VALIDATOR ====================
function isOriginAllowed(origin) {
  if (!origin) return false;
  const WHITELIST = [
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
  ];
  if (WHITELIST.includes(origin)) return true;
  // Auto-allow Cloudflare Pages previews & production
  if (/^https:\/\/[a-z0-9-]+(\.pages\.dev)$/.test(origin)) return true;
  // Auto-allow *.vercel.app (jaga-jaga kalau mau dual deploy)
  if (/^https:\/\/[a-z0-9-]+(\.vercel\.app)$/.test(origin)) return true;
  return false;
  // Tambah custom domain lo di sini setelah deploy:
  // if (origin === 'https://uix-detective.com') return true;
}

function buildCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': isOriginAllowed(origin) ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Request-Token',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  };
}

// ==================== OPTIONS (PREFLIGHT) ====================
export async function onRequestOptions({ request }) {
  const origin = request.headers.get('origin') || '';
  return new Response(null, {
    status: 200,
    headers: buildCorsHeaders(origin),
  });
}

// ==================== POST HANDLER ====================
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('origin') || '';
  const cors   = buildCorsHeaders(origin);
  const jsonError = (msg, status = 400) =>
    new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...cors, 'Content-Type': 'application/json' }
    });

  // ── Security: token validation (skip on localhost) ──
  const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');
  const token   = request.headers.get('x-request-token') || '';
  const ua      = request.headers.get('user-agent') || '';
  if (!isLocal && !validateRequestToken(token, ua)) {
    return jsonError('Forbidden: invalid request token', 403);
  }

  // ── API Key ──
  const apiKey = env.MIMO_API_KEY;
  if (!apiKey) return jsonError('MIMO_API_KEY not configured', 500);

  // ── Parse Body ──
  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body'); }

  const { url, model = 'mimo-v2-flash' } = body;
  if (!url || typeof url !== 'string') return jsonError('URL is required');

  const safeModel = ALLOWED_MODELS.includes(model) ? model : 'mimo-v2-flash';

  // ── Validate URL ──
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    return jsonError('Invalid URL — must be http:// or https://');
  }

  // ── Block private/internal IPs ──
  const h = parsedUrl.hostname;
  const PRIVATE = [/^localhost$/i, /^127\./, /^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^::1$/];
  if (PRIVATE.some(p => p.test(h))) return jsonError('Private/internal URLs not allowed');

  // ── Call MiMo API with stream: true ──
  let mimoRes;
  try {
    mimoRes = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'UIX-Detective-CF/1.0',
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
        stream: true, // ← KEY: streaming biar gak timeout
      }),
    });
  } catch (err) {
    return jsonError(`Network error: ${err.message}`, 502);
  }

  if (!mimoRes.ok) {
    const errText = await mimoRes.text().catch(() => '');
    return jsonError(`MiMo error ${mimoRes.status}: ${errText.slice(0, 200)}`, mimoRes.status);
  }

  // ── Pipe MiMo stream langsung ke client ──
  // Cloudflare Workers mendukung streaming native — gak perlu buffer
  return new Response(mimoRes.body, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
