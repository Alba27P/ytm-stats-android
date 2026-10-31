'use strict';
// Shared helpers for the popup and the dashboard.
const YTS = (() => {
  const DAY = 864e5;
  const pad = n => String(n).padStart(2, '0');
  const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const monthKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const weekday = t => (new Date(t).getDay() + 6) % 7; // Monday = 0

  // A session counts as a "play" if you listened 30s+ or at least half of a short track.
  const isPlay = p => p.d >= 30 || (p.len > 0 && p.d >= p.len * 0.5);

  function fmtDur(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec + 's';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    return `${h.toLocaleString()}h ${m % 60}m`;
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function loadPlays() {
    const all = await chrome.storage.local.get(null);
    const plays = [];
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('p_') && Array.isArray(v)) for (const p of v) plays.push(p);
    }
    plays.sort((a, b) => a.t - b.t);
    return plays;
  }

  function streaks(plays) {
    const days = new Set(plays.filter(isPlay).map(p => dayKey(p.t)));
    let longest = 0, run = 0, prev = null;
    for (const k of [...days].sort()) {
      const t = new Date(k + 'T00:00:00').getTime();
      run = (prev !== null && Math.round((t - prev) / DAY) === 1) ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = t;
    }
    let current = 0;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
    while (days.has(dayKey(d.getTime()))) { current++; d.setDate(d.getDate() - 1); }
    return { current, longest };
  }

  return { DAY, pad, dayKey, monthKey, startOfDay, weekday, isPlay, fmtDur, esc, loadPlays, streaks };
})();
