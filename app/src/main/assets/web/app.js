'use strict';
// Android-only additions: setup banner, now playing, quick stats, tracking switch, tap-for-details.
(() => {
  const A = window.AndroidBridge;
  if (!A) return;
  const $ = s => document.querySelector(s);
  const { esc, fmtDur, isPlay, startOfDay, weekday, DAY } = YTS;

  // Wording that differs from the browser extension
  const emptyP = $('#empty p');
  if (emptyP) emptyP.innerHTML = 'Open the <b>YouTube Music</b> app and play something. Sessions are saved automatically, and this screen updates live.';
  const note = $('#dataNote');
  if (note) note.textContent = 'Everything is stored on this phone. Export regularly if you want a backup — uninstalling the app deletes its data.';

  // Setup banner
  function refreshAccess() {
    const ok = A.hasAccess();
    $('#access').hidden = ok;
    $('#noYtm').hidden = A.isYtmInstalled();
  }
  $('#grant').addEventListener('click', () => A.openAccessSettings());
  $('#appInfo').addEventListener('click', () => A.openAppInfo());

  // Tracking switch
  const sw = $('#trackToggle');
  sw.checked = !A.isPaused();
  sw.addEventListener('change', () => { A.setPaused(!sw.checked); nowPlaying(); });

  function nowPlaying() {
    const el = $('#np');
    const raw = A.getNowPlaying();
    if (!sw.checked) {
      el.innerHTML = '<span class="art ph"></span><div class="nm"><span class="live">Tracking paused</span><b>Flip the switch to resume</b></div>';
      el.onclick = null;
      return;
    }
    if (!raw) {
      el.innerHTML = '<span class="art ph"></span><div class="nm"><span class="live">Nothing playing</span><b>Open YouTube Music</b><small>Tap to launch the app</small></div>';
      el.onclick = () => A.openYtm();
      return;
    }
    const n = JSON.parse(raw);
    el.onclick = () => A.openYtm();
    el.innerHTML = `${n.art ? `<img class="art" src="${esc(n.art)}" referrerpolicy="no-referrer" alt="">` : '<span class="art ph"></span>'}
      <div class="nm"><span class="live">${n.playing ? '● Now playing' : 'Paused'}</span><b>${esc(n.title)}</b><small>${esc(n.artist)}${n.listened ? ' · ' + fmtDur(n.listened) + ' listened' : ''}</small></div>`;
  }

  function quick() {
    if (typeof ALL === 'undefined') return;
    const now = Date.now();
    const today = startOfDay(now);
    const week = today - weekday(now) * DAY;
    const d = new Date(now);
    const month = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    let t = 0, w = 0, m = 0, plays = 0;
    for (const p of ALL) {
      if (p.t >= month) m += p.d;
      if (p.t >= week) w += p.d;
      if (p.t >= today) { t += p.d; if (isPlay(p)) plays++; }
    }
    $('#quick').innerHTML = [
      ['Today', fmtDur(t), `${plays} plays`],
      ['This week', fmtDur(w), ''],
      ['This month', fmtDur(m), '']
    ].map(([l, v, s]) => `<div><span>${l}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`).join('');
  }

  // Touch screens have no hover: tap a bar or heatmap cell to see its value.
  let toastT;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.hidden = true; }, 2200);
  }
  document.addEventListener('click', e => {
    const t = e.target;
    let txt = null;
    if (t.matches('svg.chart rect')) { const ti = t.querySelector('title'); txt = ti && ti.textContent; }
    else if (t.matches('.cal-grid i, .hw i')) txt = t.getAttribute('title');
    if (txt) toast(txt);
  });

  // Calendar is wider than the phone: keep it scrolled to the most recent weeks.
  const cal = $('#calendar');
  new MutationObserver(() => { cal.scrollLeft = cal.scrollWidth; }).observe(cal, { childList: true });

  window.__ytmsResume = () => { refreshAccess(); nowPlaying(); quick(); };
  refreshAccess();
  nowPlaying();
  setTimeout(quick, 600);
  setInterval(() => { nowPlaying(); quick(); }, 4000);
})();
