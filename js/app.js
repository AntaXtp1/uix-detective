// ============================================
//   UI/UX REVERSE ENGINEER — App Logic v2
//   + Rate Limiting harian via localStorage
//   + Reset/back to home
//   + History fix
// ============================================

// ==================== CONSTANTS ====================
const MODELS = {
  'mimo-v2-flash': { label: 'Flash · Cepat', limit: 5 },
  'mimo-v2.5':     { label: 'v2.5 · Omni',   limit: 3 },
};
const DEFAULT_MODEL = 'mimo-v2-flash';

// ==================== STATE ====================
const state = {
  currentResult: null,
  isLoading: false,
  history: [],
  downloadOpen: false,
  thinkingOpen: false,
  hasResult: false,
};

// ==================== DOM REFS ====================
const $ = id => document.getElementById(id);
const urlInput        = $('url-input');
const modelSelect     = $('model-select');
const analyzeBtn      = $('analyze-btn');
const btnText         = $('btn-text');
const btnSpinner      = $('btn-spinner');
const emptyState      = $('empty-state');
const shimmerLines    = $('shimmer-lines');
const renderedPanel   = $('rendered-panel');
const rawPanel        = $('raw-panel');
const renderedOutput  = $('rendered-output');
const rawTextarea     = $('raw-textarea');
const thinkingPanel   = $('thinking-panel');
const thinkingBody    = $('thinking-body-text');
const statusBar       = $('status-bar');
const statusText      = $('status-text');
const copyBtn         = $('copy-btn');
const downloadBtn     = $('download-btn');
const downloadMenu    = $('download-menu');
const historyList     = $('history-list');
const clearHistoryBtn = $('clear-history');
const statsWords      = $('stats-words');
const statsChars      = $('stats-chars');
const tokenPrompt     = $('token-prompt');
const tokenCompletion = $('token-completion');
const tokenRow        = $('token-row');
const toastContainer  = $('toast-container');
const limitBadge      = $('limit-badge');
const newAnalysisBtn  = $('new-analysis-btn');
const logoLink        = $('logo-link');

// ==================== RATE LIMITING ====================
function getRateLimitData() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = localStorage.getItem('uix-rate-limit');
    if (!raw) return { date: today, counts: {} };
    const data = JSON.parse(raw);
    // Reset kalau hari baru
    if (data.date !== today) return { date: today, counts: {} };
    return data;
  } catch {
    return { date: today, counts: {} };
  }
}

function saveRateLimitData(data) {
  try {
    localStorage.setItem('uix-rate-limit', JSON.stringify(data));
  } catch (_) {}
}

function checkRateLimit(model) {
  const info  = MODELS[model] || MODELS[DEFAULT_MODEL];
  const data  = getRateLimitData();
  const used  = data.counts[model] || 0;
  const limit = info.limit;
  return { allowed: used < limit, used, limit, remaining: Math.max(0, limit - used) };
}

function incrementRateLimit(model) {
  const data = getRateLimitData();
  data.counts[model] = (data.counts[model] || 0) + 1;
  saveRateLimitData(data);
}

function getMidnightCountdown() {
  const now       = new Date();
  const midnight  = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diff      = midnight - now;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}j ${m}m`;
}

function updateLimitBadge() {
  if (!limitBadge || !modelSelect) return;
  const model  = modelSelect.value;
  const { remaining, limit } = checkRateLimit(model);
  const isFlash = model === 'mimo-v2-flash';

  limitBadge.innerHTML = `
    <span class="limit-dot ${remaining === 0 ? 'limit-empty' : ''}"></span>
    <span class="limit-text">
      ${remaining === 0
        ? `Limit habis · reset ${getMidnightCountdown()}`
        : `${remaining}/${limit} sisa hari ini`}
    </span>
  `;
  limitBadge.className = `limit-badge ${remaining === 0 ? 'limit-exceeded' : ''}`;

  // Disable tombol kalau limit habis
  const limitReached = remaining === 0;
  analyzeBtn.disabled = limitReached || state.isLoading;
  if (limitReached) {
    btnText.textContent = 'Limit Harian Habis';
  } else if (!state.isLoading) {
    btnText.textContent = 'Analyze Design';
  }
}

// ==================== INIT ====================
function init() {
  loadHistory();
  renderHistory();
  setupEventListeners();
  updateLimitBadge();

  // Restore last URL dari session
  const lastUrl = sessionStorage.getItem('last-url');
  if (lastUrl) urlInput.value = lastUrl;
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
  analyzeBtn.addEventListener('click', handleAnalyze);
  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAnalyze();
  });
  urlInput.addEventListener('input', () => {
    sessionStorage.setItem('last-url', urlInput.value);
  });
  urlInput.addEventListener('blur', validateUrl);

  // Update badge saat model ganti
  modelSelect.addEventListener('change', updateLimitBadge);

  // Tabs
  document.querySelectorAll('.workspace-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Copy
  copyBtn.addEventListener('click', handleCopy);

  // Download dropdown
  downloadBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleDownloadMenu();
  });
  document.addEventListener('click', () => closeDownloadMenu());
  $('download-md').addEventListener('click',  () => downloadFile('md'));
  $('download-txt').addEventListener('click', () => downloadFile('txt'));

  // Thinking toggle
  $('thinking-header').addEventListener('click', toggleThinking);

  // Clear history
  clearHistoryBtn.addEventListener('click', () => {
    if (state.history.length === 0) return;
    if (confirm('Hapus semua history? Gak bisa di-undo.')) {
      state.history = [];
      saveHistory();
      renderHistory();
      showToast('History dihapus.', 'info');
    }
  });

  // ← New Analysis button (header)
  if (newAnalysisBtn) {
    newAnalysisBtn.addEventListener('click', resetToHome);
  }

  // Logo juga bisa reset
  if (logoLink) {
    logoLink.addEventListener('click', e => {
      e.preventDefault();
      resetToHome();
    });
  }
}

// ==================== RESET TO HOME ====================
function resetToHome() {
  state.currentResult = null;
  state.hasResult = false;

  // Reset workspace
  renderedOutput.innerHTML = '';
  rawTextarea.value = '';
  emptyState.style.display = 'flex';
  renderedPanel.classList.remove('active');
  rawPanel.classList.remove('active');
  thinkingPanel.classList.remove('visible', 'open');
  tokenRow.style.display = 'none';

  // Reset status
  statusBar.className = 'status-bar';

  // Reset buttons
  copyBtn.disabled = true;
  downloadBtn.disabled = true;

  // Reset URL input
  urlInput.value = '';
  sessionStorage.removeItem('last-url');

  // Sembunyikan tombol new analysis di header
  updateNewAnalysisBtn(false);

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Focus URL input
  setTimeout(() => urlInput.focus(), 300);
  showToast('Siap buat analisis baru!', 'info');
}

function updateNewAnalysisBtn(show) {
  if (!newAnalysisBtn) return;
  newAnalysisBtn.style.display = show ? 'flex' : 'none';
}

// ==================== URL VALIDATION ====================
function validateUrl() {
  const val = urlInput.value.trim();
  if (!val) return true;
  try {
    new URL(val.startsWith('http') ? val : 'https://' + val);
    urlInput.style.borderColor = '';
    return true;
  } catch {
    urlInput.style.borderColor = 'var(--red)';
    return false;
  }
}

function normalizeUrl(url) {
  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  return url;
}

// ==================== MAIN ANALYZE HANDLER ====================
async function handleAnalyze() {
  if (state.isLoading) return;

  let url = urlInput.value.trim();
  if (!url) {
    showToast('Masukkin URL dulu, bro.', 'error');
    urlInput.focus();
    return;
  }

  url = normalizeUrl(url);
  urlInput.value = url;

  try { new URL(url); } catch {
    showToast('URL-nya gak valid.', 'error');
    return;
  }

  const model = modelSelect.value;

  // ── Cek rate limit ──
  const rateCheck = checkRateLimit(model);
  if (!rateCheck.allowed) {
    showToast(`Limit harian habis (${rateCheck.limit}x). Reset ${getMidnightCountdown()} lagi.`, 'error');
    updateLimitBadge();
    return;
  }

  setLoading(true);
  setStatus('loading', `Nge-crawl ${getDomain(url)}...`);
  showShimmer();

  try {
    const requestToken = typeof window.__getRequestToken === 'function'
      ? window.__getRequestToken() : '';

    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-Request-Token': requestToken,
      },
      body: JSON.stringify({ url, model }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Server error ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      // ── STREAMING MODE (Cloudflare / local dev) ──
      incrementRateLimit(model);
      updateLimitBadge();
      await handleStreamingResponse(response, url, model);
    } else {
      // ── FALLBACK: non-streaming ──
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      incrementRateLimit(model);
      updateLimitBadge();
      finalizeStream(data.content, data.thinking, data.usage, url, model);
    }

  } catch (err) {
    setStatus('error', `Error: ${err.message}`);
    showToast(`Gagal: ${err.message}`, 'error');
    hideShimmer();
    showEmpty();
  } finally {
    setLoading(false);
  }
}

// ==================== STREAMING HANDLER ====================
async function handleStreamingResponse(response, url, model) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();

  let content   = '';
  let thinking  = '';
  let usage     = null;
  let buffer    = '';
  let lastRender = 0;
  const RENDER_THROTTLE = 300; // ms — jangan render tiap karakter, boros

  // Tampilkan workspace kosong dulu biar user tau proses mulai
  hideShimmer();
  state.hasResult = true;
  emptyState.style.display = 'none';
  switchTab('rendered');
  renderedOutput.innerHTML = '<p class="stream-cursor">AI lagi nulis...</p>';
  copyBtn.disabled     = false;
  downloadBtn.disabled = false;
  updateNewAnalysisBtn(true);
  setStatus('loading', 'AI lagi nulis blueprint...');

  // Throttled render function
  function flushRender() {
    const now = Date.now();
    if (now - lastRender < RENDER_THROTTLE) return;
    lastRender = now;
    renderedOutput.innerHTML = parseMarkdown(content) + '<span class="stream-cursor-blink"></span>';
    rawTextarea.value = content;
    updateStats(content);
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // simpan baris incomplete

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') {
          finalizeStream(content, thinking, usage, url, model);
          return;
        }

        try {
          const chunk = JSON.parse(raw);
          if (chunk.error) throw new Error(chunk.error);

          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content)           content  += delta.content;
          if (delta?.reasoning_content) thinking += delta.reasoning_content;
          if (chunk.usage)              usage     = chunk.usage;

          flushRender();
        } catch (parseErr) {
          // Skip chunk yang rusak — bukan masalah
          if (parseErr.message !== 'Unexpected token') {
            throw parseErr; // Re-throw error nyata (bukan parse error)
          }
        }
      }
    }

    // Stream selesai tanpa [DONE] — tetap finalize kalau ada content
    if (content) finalizeStream(content, thinking, usage, url, model);
    else throw new Error('Stream kosong — tidak ada output dari AI');

  } catch (err) {
    if (content && content.length > 100) {
      // Ada partial output yang cukup — tampilkan aja, jangan buang
      finalizeStream(content, thinking, usage, url, model);
      showToast('Stream terputus. Blueprint parsial berhasil disimpan.', 'info');
    } else {
      throw err; // Balikin ke caller buat error handling
    }
  }
}

// ==================== FINALIZE STREAM ====================
function finalizeStream(content, thinking, usage, url, model) {
  state.currentResult = {
    url, model, content, thinking, usage,
    timestamp: new Date().toISOString(),
  };

  // Final render tanpa cursor
  renderedOutput.innerHTML = parseMarkdown(content);
  rawTextarea.value = content;
  updateStats(content);

  if (thinking) {
    thinkingPanel.classList.add('visible');
    thinkingBody.textContent = thinking;
    thinkingPanel.classList.remove('open');
  }

  if (usage) {
    tokenPrompt.textContent     = usage.prompt_tokens?.toLocaleString()     || '–';
    tokenCompletion.textContent = usage.completion_tokens?.toLocaleString() || '–';
    tokenRow.style.display = 'flex';
  }

  addToHistory(state.currentResult);

  const remaining = checkRateLimit(model).remaining;
  setStatus('success',
    `Selesai!${usage ? ` · ${usage.total_tokens?.toLocaleString()} tokens` : ''} · Sisa ${remaining}x hari ini`
  );
  showToast('Blueprint siap! 🎉', 'success');
}

// ==================== RENDER RESULT ====================
function renderResult(result) {
  hideShimmer();
  state.hasResult = true;

  emptyState.style.display = 'none';
  renderedOutput.innerHTML = parseMarkdown(result.content);
  rawTextarea.value = result.content;

  switchTab('rendered');
  updateStats(result.content);

  if (result.thinking) {
    thinkingPanel.classList.add('visible');
    thinkingBody.textContent = result.thinking;
    thinkingPanel.classList.remove('open');
  } else {
    thinkingPanel.classList.remove('visible');
  }

  if (result.usage) {
    tokenPrompt.textContent     = result.usage.prompt_tokens?.toLocaleString()     || '–';
    tokenCompletion.textContent = result.usage.completion_tokens?.toLocaleString() || '–';
    tokenRow.style.display = 'flex';
  } else {
    tokenRow.style.display = 'none';
  }

  copyBtn.disabled     = false;
  downloadBtn.disabled = false;

  // Tampilkan tombol "← New Analysis" di header
  updateNewAnalysisBtn(true);
}

// ==================== MARKDOWN PARSER ====================
function parseMarkdown(md) {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`
  );
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/^---+$/gm, '<hr>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/(\|.+\|\n)+/g, match => {
    const rows = match.trim().split('\n').filter(r => !r.match(/^\|[\s-|]+\|$/));
    if (rows.length < 1) return match;
    const [headerRow, ...bodyRows] = rows;
    const headers = headerRow.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const body = bodyRows.map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
  });
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/(^[-*+] .+$\n?)+/gm, match => {
    const items = match.trim().split('\n').map(li => `<li>${li.replace(/^[-*+] /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  html = html.replace(/(^\d+\. .+$\n?)+/gm, match => {
    const items = match.trim().split('\n').map(li => `<li>${li.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });
  html = html.replace(/^(?!<[a-zA-Z])(.+)$/gm, line => {
    if (!line.trim()) return '';
    return `<p>${line}</p>`;
  });
  html = html.replace(/\n{3,}/g, '\n\n');
  return html;
}

// ==================== TAB SWITCHING ====================
function switchTab(tabName) {
  document.querySelectorAll('.workspace-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  renderedPanel.classList.toggle('active', tabName === 'rendered');
  rawPanel.classList.toggle('active',      tabName === 'raw');
}

// ==================== COPY ====================
async function handleCopy() {
  if (!state.currentResult) return;
  try {
    await navigator.clipboard.writeText(state.currentResult.content);
    copyBtn.classList.add('copied');
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!`;
    showToast('Prompt berhasil di-copy!', 'success');
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy Prompt`;
    }, 2000);
  } catch {
    showToast('Gagal copy. Coba Raw tab.', 'error');
  }
}

// ==================== DOWNLOAD ====================
function toggleDownloadMenu() {
  state.downloadOpen = !state.downloadOpen;
  downloadMenu.classList.toggle('open', state.downloadOpen);
}
function closeDownloadMenu() {
  state.downloadOpen = false;
  downloadMenu.classList.remove('open');
}
function downloadFile(format) {
  if (!state.currentResult) return;
  closeDownloadMenu();
  const domain   = getDomain(state.currentResult.url);
  const date     = new Date().toISOString().slice(0, 10);
  const filename = `ui-blueprint_${domain}_${date}.${format}`;
  const content  = format === 'md'
    ? state.currentResult.content
    : state.currentResult.content.replace(/#{1,6} /g, '').replace(/\*\*/g, '').replace(/`/g, '');
  const blob = new Blob([content], { type: format === 'md' ? 'text/markdown' : 'text/plain' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Downloaded: ${filename}`, 'success');
}

// ==================== STATS ====================
function updateStats(content) {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  statsWords.textContent = words.toLocaleString();
  statsChars.textContent = content.length.toLocaleString();
}

// ==================== LOADING STATES ====================
function setLoading(loading) {
  state.isLoading = loading;
  urlInput.disabled    = loading;
  modelSelect.disabled = loading;

  if (loading) {
    analyzeBtn.disabled     = true;
    btnText.textContent     = 'Analyzing...';
    btnSpinner.classList.add('active');
  } else {
    btnSpinner.classList.remove('active');
    updateLimitBadge(); // re-check limit setelah loading selesai
  }
}

function showShimmer() {
  emptyState.style.display = 'none';
  shimmerLines.classList.add('visible');
  renderedPanel.classList.remove('active');
  rawPanel.classList.remove('active');
}
function hideShimmer() { shimmerLines.classList.remove('visible'); }
function showEmpty()   { emptyState.style.display = 'flex'; }

// ==================== STATUS BAR ====================
function setStatus(type, message) {
  statusBar.className  = `status-bar visible ${type}`;
  statusText.textContent = message;
}

// ==================== THINKING TOGGLE ====================
function toggleThinking() {
  state.thinkingOpen = !state.thinkingOpen;
  thinkingPanel.classList.toggle('open', state.thinkingOpen);
}

// ==================== TOAST ====================
function showToast(message, type = 'info') {
  const svgIcons = {
    success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    error:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
    info:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
  };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${svgIcons[type] || svgIcons.info}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ==================== HISTORY ====================
function loadHistory() {
  try {
    const raw = localStorage.getItem('uiux-history');
    state.history = raw ? JSON.parse(raw) : [];
  } catch { state.history = []; }
}

function saveHistory() {
  try {
    localStorage.setItem('uiux-history', JSON.stringify(state.history.slice(0, 20)));
  } catch (_) {}
}

function addToHistory(result) {
  state.history = state.history.filter(h => h.url !== result.url);
  state.history.unshift({
    url: result.url, model: result.model,
    content: result.content, thinking: result.thinking,
    usage: result.usage, timestamp: result.timestamp,
  });
  state.history = state.history.slice(0, 20);
  saveHistory();
  renderHistory();
}

function deleteHistoryItem(url, e) {
  e.stopPropagation();
  state.history = state.history.filter(h => h.url !== url);
  saveHistory();
  renderHistory();
  showToast('Item dihapus.', 'info');
}

function loadFromHistory(index) {
  const item = state.history[index];
  if (!item) return;
  state.currentResult = item;
  urlInput.value      = item.url;
  // Pastiin model yang dipilih valid, kalau gak ada fallback ke default
  const modelExists = Object.keys(MODELS).includes(item.model);
  modelSelect.value = modelExists ? item.model : DEFAULT_MODEL;

  renderResult(item);
  setStatus('success', `Loaded dari history: ${getDomain(item.url)}`);
  showToast(`Loaded: ${getDomain(item.url)}`, 'info');

  // Scroll ke workspace di mobile
  if (window.innerWidth < 768) {
    document.querySelector('.workspace-card')?.scrollIntoView({ behavior: 'smooth' });
  }
}

function renderHistory() {
  if (!historyList) return;
  if (state.history.length === 0) {
    historyList.innerHTML = `
      <div class="history-empty">
        <p>Belum ada history.<br>Analyze website pertama lo dulu!</p>
      </div>`;
    return;
  }
  historyList.innerHTML = state.history.map((item, i) => {
    const domain     = getDomain(item.url);
    const favicon    = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    const timeAgo    = getTimeAgo(item.timestamp);
    const modelShort = (item.model || DEFAULT_MODEL).replace('mimo-', '');
    return `
      <div class="history-item" onclick="loadFromHistory(${i})" role="button" tabindex="0"
           onkeydown="if(event.key==='Enter')loadFromHistory(${i})">
        <div class="history-favicon">
          <img src="${favicon}" alt="${domain}"
               onerror="this.parentElement.innerHTML='<svg width=14 height=14 viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;2&quot;><circle cx=&quot;12&quot; cy=&quot;12&quot; r=&quot;10&quot;></circle><line x1=&quot;2&quot; y1=&quot;12&quot; x2=&quot;22&quot; y2=&quot;12&quot;></line><path d=&quot;M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z&quot;></path></svg>'"
               loading="lazy">
        </div>
        <div class="history-info">
          <div class="history-url" title="${item.url}">${domain}</div>
          <div class="history-meta">
            <span>${timeAgo}</span><span>·</span>
            <span class="model-tag">${modelShort}</span>
          </div>
        </div>
        <button class="history-del" onclick="deleteHistoryItem('${item.url}', event)" title="Hapus">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>`;
  }).join('');
}

// ==================== UTILS ====================
function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return url; }
}

function getTimeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1)  return 'baru aja';
  if (mins < 60) return `${mins}m lalu`;
  if (hrs < 24)  return `${hrs}j lalu`;
  return `${days}h lalu`;
}

// ==================== EXPOSE GLOBALS ====================
window.loadFromHistory   = loadFromHistory;
window.deleteHistoryItem = deleteHistoryItem;
window.resetToHome       = resetToHome;

// ==================== BOOT ====================
document.addEventListener('DOMContentLoaded', init);
