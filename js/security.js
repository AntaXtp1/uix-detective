/**
 * UIX Detective — Security Layer
 * Anti-tamper, devtools detection, keyboard shortcut blocking
 *
 * MODE:
 *   PRODUCTION  → semua proteksi aktif
 *   LOCAL DEV   → proteksi dimatiin otomatis, lo bisa inspect bebas
 *
 * Toggle manual untuk dev:
 *   localStorage.setItem('uix_dev_mode', '1')  → matiin security
 *   localStorage.removeItem('uix_dev_mode')     → aktifin lagi
 */
(function () {
  'use strict';

  // ==================== ENV DETECTION ====================
  const _isLocalhost = (
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname.startsWith('192.168.') ||
    location.port === '3000' ||
    location.port === '8080'
  );

  // ── Secret URL bypass: ?_dbg=uixdev2025 ──
  // Kunjungi https://uix-detective.pages.dev?_dbg=uixdev2025 buat disable security
  // Jangan share URL ini ke publik!
  const _urlParams   = new URLSearchParams(location.search);
  const _urlBypass   = _urlParams.get('_dbg') === 'uixdev2025';

  // Kalau URL bypass aktif, simpan ke localStorage biar persist setelah reload
  if (_urlBypass) {
    try { localStorage.setItem('uix_dev_mode', '1'); } catch (_) {}
  }

  // Dev mode toggle — set via localStorage, URL bypass, atau otomatis kalau localhost
  const _isDevMode = _isLocalhost || _urlBypass || localStorage.getItem('uix_dev_mode') === '1';

  // Kalau dev mode, langsung skip semua proteksi
  // Token generator tetap didefinisikan (dibutuhkan app.js)
  if (_isDevMode) {
    if (_isLocalhost) {
      console.log(
        '%c🛠 UIX Detective — Dev Mode (localhost detected)\n' +
        '%cSecurity features dinonaktifkan. Inspect sesuka hati.\n' +
        'Buat matiin manual di production preview:\n' +
        'localStorage.setItem("uix_dev_mode", "1")',
        'color:#7c3aed;font-size:14px;font-weight:700;',
        'color:#64748b;font-size:12px;'
      );
    }
    // Tetap expose token generator
    window.__getRequestToken = _buildToken;
    return; // ← keluar, semua proteksi di bawah dilewat
  }

  // ==================== TOKEN GENERATOR ====================
  function _buildToken() {
    const ts  = Math.floor(Date.now() / 1000 / 300);
    const raw = `uix-detective:${ts}:${navigator.userAgent.slice(0, 20)}`;
    let h = 0;
    for (let i = 0; i < raw.length; i++) {
      h = Math.imul(31, h) + raw.charCodeAt(i) | 0;
    }
    return btoa(`${ts}:${(h >>> 0).toString(16)}`);
  }
  window.__getRequestToken = _buildToken;

  // ==================== CONSOLE DETERRENT ====================
  setTimeout(() => {
    console.log(
      '%c🛑 STOP RIGHT THERE.',
      'color:#ef4444;font-size:28px;font-weight:900;text-shadow:0 0 10px #ef4444;'
    );
    console.log(
      '%cKalau lo buka ini karena penasaran — oke, gue respect.\nKalau lo mau nyuri API key atau bypass — good luck,\nkeynya ada di server. Skill issue.',
      'color:#94a3b8;font-size:13px;line-height:1.8;'
    );
    console.log(
      '%c⚠️ Jangan paste kode apapun di sini dari orang lain.\nItu namanya Self-XSS. Seriously.',
      'color:#f59e0b;font-size:12px;font-weight:600;'
    );
    // Mute console setelah warning
    const noop = () => {};
    ['log', 'warn', 'info', 'debug', 'table', 'dir'].forEach(m => {
      try {
        Object.defineProperty(console, m, { value: noop, writable: false, configurable: false });
      } catch (_) {}
    });
  }, 800);

  // ==================== DEVTOOLS DETECTION ====================
  let _devOpen = false;
  let _blurOverlay = null;

  function _createBlurOverlay() {
    if (_blurOverlay) return;
    _blurOverlay = document.createElement('div');
    Object.assign(_blurOverlay.style, {
      position:        'fixed',
      inset:           '0',
      zIndex:          '999999',
      backdropFilter:  'blur(20px)',
      webkitBackdropFilter: 'blur(20px)',
      background:      'rgba(3, 7, 18, 0.93)',
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      flexDirection:   'column',
      gap:             '16px',
    });
    _blurOverlay.innerHTML = `
      <div style="font-size:52px">🔒</div>
      <div style="color:#f1f5f9;font-size:20px;font-weight:700;font-family:Inter,sans-serif;">
        Developer Tools Detected
      </div>
      <div style="color:#64748b;font-size:14px;font-family:Inter,sans-serif;text-align:center;max-width:320px;line-height:1.7;">
        Tutup DevTools buat lanjut pakai app.<br>
        <span style="color:#475569;font-size:12px;">Ini bukan personal — ini security policy.</span>
      </div>
    `;
    document.body.appendChild(_blurOverlay);
  }

  function _removeBlurOverlay() {
    if (_blurOverlay && _blurOverlay.parentNode) {
      _blurOverlay.parentNode.removeChild(_blurOverlay);
      _blurOverlay = null;
    }
  }

  function _checkDimensions() {
    const threshold = 160;
    return (
      (window.outerWidth - window.innerWidth)   > threshold ||
      (window.outerHeight - window.innerHeight) > threshold
    );
  }

  function _devToolsCheck() {
    const isOpen = _checkDimensions();
    if (isOpen !== _devOpen) {
      _devOpen = isOpen;
      if (isOpen) {
        if (document.body) _createBlurOverlay();
        else document.addEventListener('DOMContentLoaded', _createBlurOverlay);
      } else {
        _removeBlurOverlay();
      }
    }
  }

  setInterval(_devToolsCheck, 1500);
  window.addEventListener('resize', _devToolsCheck);

  // ==================== KEYBOARD SHORTCUT BLOCKING ====================
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F12') {
      e.preventDefault(); e.stopPropagation(); return false;
    }
    const ctrl  = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const key   = (e.key || '').toLowerCase();

    // DevTools shortcuts
    if (ctrl && shift && ['i', 'j', 'c'].includes(key)) {
      e.preventDefault(); e.stopPropagation(); return false;
    }
    // View source, Save, Print
    if (ctrl && ['u', 's', 'p'].includes(key)) {
      e.preventDefault(); return false;
    }
  }, true);

  // ==================== RIGHT-CLICK PROTECTION ====================
  document.addEventListener('contextmenu', function (e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;
    e.preventDefault();
    return false;
  });

  // ==================== ANTI-IFRAME ====================
  if (window.self !== window.top) {
    try { window.top.location = window.self.location; }
    catch { document.body.style.display = 'none'; }
  }

  // ==================== DISABLE PRINT ====================
  window.addEventListener('beforeprint', function () {
    document.body.style.display = 'none';
    setTimeout(() => { document.body.style.display = ''; }, 1000);
  });

})();
