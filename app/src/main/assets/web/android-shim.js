'use strict';
// Maps the chrome.* APIs the extension dashboard uses onto the Android app's native bridge.
(function () {
  const A = window.AndroidBridge;
  if (!A) return;
  const listeners = [];

  const local = {
    async get(keys) {
      const settings = { paused: A.isPaused() };
      if (keys == null) return { p_all: JSON.parse(A.getPlays() || '[]'), settings };
      const list = Array.isArray(keys) ? keys : [keys];
      return list.includes('settings') ? { settings } : {};
    },
    async set(obj) {
      if (obj && obj.settings) A.setPaused(!!obj.settings.paused);
    },
    async remove() {}
  };

  const session = {
    async get() {
      const s = A.getNowPlaying();
      return s ? { nowPlaying: JSON.parse(s) } : {};
    },
    async set() {},
    async remove() {}
  };

  window.chrome = {
    storage: { local, session, onChanged: { addListener(fn) { listeners.push(fn); } } },
    runtime: {
      id: 'android',
      getURL: p => p,
      async sendMessage(msg) {
        if (msg && msg.type === 'import') return JSON.parse(A.importPlays(JSON.stringify(msg.plays || [])));
        if (msg && msg.type === 'clear') { A.clearAll(); return { ok: true }; }
        return { ok: true };
      }
    },
    tabs: { create() {} }
  };

  // Called by the app whenever the database changes.
  window.__ytmsChanged = () => listeners.forEach(fn => { try { fn({ p_all: {} }, 'local'); } catch (e) { /* ignore */ } });
})();
