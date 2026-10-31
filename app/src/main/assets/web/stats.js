'use strict';
const { DAY, dayKey, monthKey, startOfDay, weekday, isPlay, fmtDur, esc } = YTS;
const $ = (s, r = document) => r.querySelector(s);
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WD_LONG = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let ALL = [];
const state = { range: 'all', metric: 'time', topN: { artists: 10, tracks: 10, albums: 10 }, histN: 50 };
try {
  const s = JSON.parse(localStorage.getItem('ytms') || '{}');
  if (s.range) state.range = s.range;
  if (s.metric) state.metric = s.metric;
} catch { /* ignore */ }
const persist = () => { try { localStorage.setItem('ytms', JSON.stringify({ range: state.range, metric: state.metric })); } catch { /* ignore */ } };

// ---------- helpers ----------
const trackKey = p => p.title + '\u0001' + p.artist;
const albumKey = p => (p.album ? p.album + '\u0001' + p.artist : null);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const pct = x => (x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0) + '%';
const fmtDate = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtShortDate = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateTime = t => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const monthLabel = k => { const [y, m] = k.split('-'); return `${MON[+m - 1]} ${y}`; };
const hrs = v => (v === 0 ? '0' : v < 1 ? Math.round(v * 60) + 'm' : +v.toFixed(1) + 'h');
const isPlays = () => state.metric === 'plays';
const mval = p => (isPlays() ? (isPlay(p) ? 1 : 0) : p.d);
const scale = v => (isPlays() ? v : v / 3600);
const axisFmt = () => (isPlays() ? v => String(+v.toFixed(1)) : hrs);
const tipVal = v => (isPlays() ? `${v.toLocaleString()} plays` : fmtDur(v));
const hourLabel = h => `${String(h).padStart(2, '0')}:00`;
const art = (src, cls = '') => (src
  ? `<img class="art ${cls}" src="${esc(src)}" loading="lazy" referrerpolicy="no-referrer" alt="">`
  : `<span class="art ph ${cls}"></span>`);

function agg(P, keyFn) {
  const m = new Map();
  for (const p of P) {
    const k = keyFn(p);
    if (k == null) continue;
    let a = m.get(k);
    if (!a) { a = { key: k, time: 0, plays: 0, n: 0, first: p.t, last: p.t, p }; m.set(k, a); }
    a.time += p.d; a.n++;
    if (isPlay(p)) a.plays++;
    if (p.t < a.first) a.first = p.t;
    if (p.t >= a.last) { a.last = p.t; if (p.art || !a.p.art) a.p = p; }
  }
  return [...m.values()];
}
const val = a => (isPlays() ? a.plays : a.time);
const sortAgg = arr => arr.sort((a, b) => val(b) - val(a) || b.time - a.time);

function sessions(P) {
  const out = [];
  let cur = null;
  for (const p of P) {
    const end = p.e || p.t + p.d * 1000;
    if (cur && p.t - cur.end <= 30 * 60e3) { cur.time += p.d; cur.end = Math.max(cur.end, end); cur.n++; }
    else { cur = { start: p.t, end, time: p.d, n: 1 }; out.push(cur); }
  }
  return out;
}

function niceMax(m) {
  if (m <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(m)));
  const f = m / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function barChart(items, o = {}) {
  const narrow = window.innerWidth < 700;
  const W = narrow ? Math.min(o.w || 960, 440) : (o.w || 960), H = narrow ? Math.round((o.h || 210) * 1.15) : (o.h || 210), L = 42, R = 6, T = 10, B = 24;
  const max = niceMax(Math.max(0, ...items.map(i => i.v)));
  const n = items.length || 1;
  const cw = (W - L - R) / n;
  const gap = Math.min(4, cw * 0.25);
  const every = o.every || Math.ceil(n / (o.maxLabels || (narrow ? 6 : 12)));
  const fmt = o.fmt || (v => String(+v.toFixed(1)));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (let k = 0; k <= 4; k++) {
    const y = T + (H - T - B) * (1 - k / 4);
    s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/>` +
      `<text x="${L - 6}" y="${y + 3}" text-anchor="end">${fmt(max * k / 4)}</text>`;
  }
  items.forEach((it, i) => {
    const h = (H - T - B) * (it.v / max);
    const x = L + i * cw + gap / 2;
    const w = Math.max(1, cw - gap);
    s += `<rect class="b${it.hi ? ' hi' : ''}" x="${x.toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="${Math.min(3, w / 2).toFixed(1)}"><title>${esc(it.tip || it.label)}</title></rect>`;
    if (i % every === 0) s += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  return s + '</svg>';
}

// ---------- range ----------
function buildRangeOptions() {
  const years = [...new Set(ALL.map(p => new Date(p.t).getFullYear()))].sort((a, b) => b - a);
  const opts = [['all', 'All time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months'],
    ...years.map(y => ['y' + y, String(y)])];
  const sel = $('#range');
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  if (!opts.some(o => o[0] === state.range)) state.range = 'all';
  sel.value = state.range;
}

function bounds() {
  const now = Date.now();
  const r = state.range;
  if (r === 'all') return { from: ALL.length ? startOfDay(ALL[0].t) : startOfDay(now), to: now };
  if (r[0] === 'y') {
    const y = +r.slice(1);
    return { from: new Date(y, 0, 1).getTime(), to: Math.min(now, new Date(y + 1, 0, 1).getTime() - 1) };
  }
  return { from: startOfDay(now - (+r - 1) * DAY), to: now };
}
const spanDays = B => Math.max(1, Math.round((startOfDay(B.to) - startOfDay(B.from)) / DAY) + 1);

// ---------- render ----------
async function load() {
  ALL = await YTS.loadPlays();
  buildRangeOptions();
  render();
}

function render() {
  const has = ALL.length > 0;
  $('#empty').hidden = has;
  document.querySelectorAll('.needs-data').forEach(e => { e.hidden = !has; });
  document.querySelectorAll('#metric button').forEach(b => b.classList.toggle('on', b.dataset.m === state.metric));
  if (!has) { $('#subtitle').textContent = 'No listening data yet'; return; }
  $('#subtitle').textContent = `Tracking since ${fmtShortDate(ALL[0].t)} · ${ALL.filter(isPlay).length.toLocaleString()} plays recorded`;
  const B = bounds();
  const P = ALL.filter(p => p.t >= B.from && p.t <= B.to);
  renderCards(P, B);
  renderProfile(P);
  renderActivity(P, B);
  renderCalendar();
  renderHabits(P);
  renderTops(P);
  renderDiscovery(P, B);
  renderRecords(P);
  renderMonthly(P);
  renderHistory(P);
}

function renderCards(P, B) {
  const time = sum(P, p => p.d);
  const plays = P.filter(isPlay).length;
  const skips = P.length - plays;
  const tracks = new Set(P.map(trackKey)).size;
  const artists = new Set(P.map(p => p.artist)).size;
  const albums = new Set(P.map(albumKey).filter(Boolean)).size;
  const days = spanDays(B);
  const active = new Set(P.map(p => dayKey(p.t))).size;
  const S = sessions(P);
  const longest = S.reduce((m, s) => Math.max(m, s.time), 0);
  const st = YTS.streaks(ALL);
  const cards = [
    ['Listening time', fmtDur(time), `${(time / 3600).toFixed(1)} hours · ${(time / 86400).toFixed(1)} days`, true],
    ['Plays', plays.toLocaleString(), `${skips.toLocaleString()} skipped · ${pct(P.length ? skips / P.length : 0)} skip rate`],
    ['Daily average', fmtDur(time / days), `${fmtDur(active ? time / active : 0)} on days you listened`],
    ['Active days', active.toLocaleString(), `of ${days.toLocaleString()} days (${pct(active / days)})`],
    ['Artists', artists.toLocaleString(), `${albums.toLocaleString()} albums`],
    ['Tracks', tracks.toLocaleString(), `${plays && tracks ? (plays / tracks).toFixed(1) : 0} plays per track`],
    ['Listening streak', `${st.current} day${st.current === 1 ? '' : 's'}`, `Longest ever: ${st.longest} days`],
    ['Sessions', S.length.toLocaleString(), `avg ${fmtDur(S.length ? time / S.length : 0)} · longest ${fmtDur(longest)}`]
  ];
  $('#cards').innerHTML = cards.map(([l, v, s, hero]) =>
    `<div class="card${hero ? ' hero' : ''}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');
}

function renderProfile(P) {
  const el = $('#profile');
  const total = sum(P, p => p.d);
  if (!P.length || !total) { el.innerHTML = '<p class="muted">No listening in this period.</p>'; return; }

  const byHour = Array(24).fill(0);
  const byWd = Array(7).fill(0);
  const hw = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const p of P) {
    const d = new Date(p.t);
    byHour[d.getHours()] += p.d;
    byWd[weekday(p.t)] += p.d;
    hw[weekday(p.t)][d.getHours()] += p.d;
  }
  let pw = 0, ph = 0;
  hw.forEach((row, w) => row.forEach((v, h) => { if (v > hw[pw][ph]) { pw = w; ph = h; } }));

  const part = (a, b) => { let s = 0; for (let h = a; h < b; h++) s += byHour[h % 24]; return s / total; };
  const tod = [
    ['🌙', 'Night owl', part(22, 29), 'between 10pm and 5am'],
    ['🌅', 'Early bird', part(5, 12), 'in the morning'],
    ['☀️', 'Afternoon groover', part(12, 17), 'in the afternoon'],
    ['🌆', 'Evening unwinder', part(17, 22), 'in the evening']
  ].sort((a, b) => b[2] - a[2])[0];

  const tags = [[tod[0], tod[1], `${pct(tod[2])} of your listening happens ${tod[3]}.`]];

  const we = (byWd[5] + byWd[6]) / total;
  const ratio = (we / 2) / Math.max(1e-9, (1 - we) / 5);
  if (ratio > 1.3) tags.push(['🎉', 'Weekend warrior', `You listen ${ratio.toFixed(1)}× more per day on weekends.`]);
  else if (ratio < 0.75) tags.push(['💼', 'Workday soundtrack', `Weekdays get ${(1 / ratio).toFixed(1)}× more listening per day than weekends.`]);
  else tags.push(['📆', 'Every-day listener', 'Your listening is spread evenly across the week.']);

  const artists = agg(P, p => p.artist).sort((a, b) => b.time - a.time);
  const top5 = sum(artists.slice(0, 5), a => a.time) / total;
  if (artists.length >= 5 && top5 > 0.5) tags.push(['💖', 'Superfan', `Your top 5 artists take up ${pct(top5)} of your listening.`]);
  else if (top5 < 0.2) tags.push(['🧭', 'Explorer', `Your top 5 artists are only ${pct(top5)} of your time across ${artists.length} artists.`]);
  else tags.push(['🎨', 'Balanced palette', `Top 5 artists: ${pct(top5)} of your time, across ${artists.length} artists overall.`]);

  const skipRate = P.filter(p => !isPlay(p)).length / P.length;
  if (skipRate > 0.35) tags.push(['⏭️', 'Restless skipper', `You skip ${pct(skipRate)} of tracks within 30 seconds.`]);
  else if (skipRate < 0.12) tags.push(['🎧', 'Full-track listener', `You only skip ${pct(skipRate)} of tracks.`]);

  const perDay = new Map();
  for (const p of P) if (isPlay(p)) { const k = dayKey(p.t) + '|' + trackKey(p); perDay.set(k, (perDay.get(k) || 0) + 1); }
  let rep = null;
  for (const [k, n] of perDay) if (!rep || n > rep[1]) rep = [k, n];
  if (rep && rep[1] >= 5) {
    const [, tk] = rep[0].split('|');
    const [title, artist] = tk.split('\u0001');
    tags.push(['🔁', 'On repeat', `You once played “${title}” by ${artist} ${rep[1]} times in a single day.`]);
  }

  el.innerHTML = `<div class="peak">You listen most on <b>${WD_LONG[pw]}</b> around <b>${hourLabel(ph)}</b>, and your favourite artist is <b>${esc(artists[0].key)}</b>.</div>
    <div class="tags">${tags.map(([e, t, s]) => `<div class="tag"><div class="e">${e}</div><div><b>${t}</b><span>${esc(s)}</span></div></div>`).join('')}</div>`;
}

function weekStart(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - weekday(d.getTime())); return d.getTime(); }

function renderActivity(P, B) {
  const days = spanDays(B);
  const mode = days <= 120 ? 'day' : days <= 730 ? 'week' : 'month';
  const keyOf = t => (mode === 'day' ? dayKey(t) : mode === 'week' ? dayKey(weekStart(t)) : monthKey(t));
  const buckets = new Map();
  let d = new Date(startOfDay(B.from));
  if (mode === 'week') d = new Date(weekStart(d.getTime()));
  if (mode === 'month') d = new Date(d.getFullYear(), d.getMonth(), 1);
  let guard = 0;
  while (d.getTime() <= B.to && guard++ < 5000) {
    const k = keyOf(d.getTime());
    if (!buckets.has(k)) buckets.set(k, { t: d.getTime(), v: 0 });
    if (mode === 'day') d.setDate(d.getDate() + 1);
    else if (mode === 'week') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
  }
  for (const p of P) { const b = buckets.get(keyOf(p.t)); if (b) b.v += mval(p); }
  const label = t => {
    const x = new Date(t);
    if (mode === 'month') return `${MON[x.getMonth()]} ’${String(x.getFullYear()).slice(2)}`;
    return `${x.getDate()} ${MON[x.getMonth()]}`;
  };
  const items = [...buckets.values()].map(b => ({
    v: scale(b.v), label: label(b.t),
    tip: `${mode === 'week' ? 'Week of ' : ''}${mode === 'month' ? monthLabel(monthKey(b.t)) : fmtShortDate(b.t)}: ${tipVal(b.v)}`
  }));
  $('#actNote').textContent = `${isPlays() ? 'plays' : 'hours'} per ${mode}`;
  $('#activity').innerHTML = barChart(items, { fmt: axisFmt() });
}

function renderCalendar() {
  let start, end;
  if (state.range[0] === 'y') {
    const y = +state.range.slice(1);
    start = new Date(y, 0, 1); end = new Date(y, 11, 31);
  } else {
    end = new Date(); end.setHours(0, 0, 0, 0);
    start = new Date(end); start.setDate(start.getDate() - 364);
  }
  const s0 = start.getTime(), e0 = end.getTime() + DAY;
  const per = new Map();
  for (const p of ALL) if (p.t >= s0 && p.t < e0) { const k = dayKey(p.t); per.set(k, (per.get(k) || 0) + p.d); }
  const vals = [...per.values()].filter(v => v > 0).sort((a, b) => a - b);
  const q = f => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(f * vals.length))] : 0);
  const th = [q(0.25), q(0.5), q(0.75)];
  const level = v => (v <= 0 ? 0 : v <= th[0] ? 1 : v <= th[1] ? 2 : v <= th[2] ? 3 : 4);

  const d = new Date(start); d.setDate(d.getDate() - weekday(d.getTime()));
  const cells = [];
  const months = [];
  let col = 0, lastMonth = -1;
  while (d.getTime() <= end.getTime()) {
    for (let r = 0; r < 7; r++) {
      const t = d.getTime();
      const inside = t >= s0 && t <= end.getTime();
      if (r === 0) {
        const probe = new Date(t); probe.setDate(probe.getDate() + 6);
        const m = (inside ? d : probe).getMonth();
        if (m !== lastMonth && probe.getTime() >= s0) { months.push([col, MON[m]]); lastMonth = m; }
      }
      if (inside) {
        const v = per.get(dayKey(t)) || 0;
        cells.push(`<i class="l${level(v)}" title="${esc(fmtDate(t))}: ${v ? fmtDur(v) : 'no listening'}"></i>`);
      } else cells.push('<i class="out"></i>');
      d.setDate(d.getDate() + 1);
    }
    col++;
  }
  const activeDays = vals.length;
  $('#calNote').textContent = `${activeDays} active days`;
  $('#calendar').innerHTML = `<div class="cal">
      <div class="cal-months" style="grid-template-columns:repeat(${col},1fr)">${months.map(([c, m]) => `<span style="grid-column:${c + 1}">${m}</span>`).join('')}</div>
      <div class="cal-wd"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span>Sun</span></div>
      <div class="cal-grid" style="grid-template-columns:repeat(${col},1fr)">${cells.join('')}</div>
    </div>
    <div class="legend">Less <i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More</div>`;
}

function renderHabits(P) {
  const byHour = Array(24).fill(0), byWd = Array(7).fill(0);
  const hw = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const p of P) {
    const h = new Date(p.t).getHours(), w = weekday(p.t), v = mval(p);
    byHour[h] += v; byWd[w] += v; hw[w][h] += p.d;
  }
  const ph = byHour.indexOf(Math.max(...byHour));
  const pw = byWd.indexOf(Math.max(...byWd));
  $('#hours').innerHTML = barChart(byHour.map((v, h) => ({ v: scale(v), label: String(h), hi: h === ph && v > 0, tip: `${hourLabel(h)}–${hourLabel((h + 1) % 24)}: ${tipVal(v)}` })), { h: 200, every: 3, fmt: axisFmt() });
  $('#weekdays').innerHTML = barChart(byWd.map((v, w) => ({ v: scale(v), label: WD[w], hi: w === pw && v > 0, tip: `${WD_LONG[w]}: ${tipVal(v)}` })), { h: 200, every: 1, fmt: axisFmt() });
  $('#hourNote').textContent = byHour[ph] > 0 ? `peak ${hourLabel(ph)}` : '';
  $('#wdNote').textContent = byWd[pw] > 0 ? `peak ${WD_LONG[pw].slice(0, -1)}` : '';

  const max = Math.max(1, ...hw.flat());
  let g = '<div class="hw"><span></span>';
  for (let h = 0; h < 24; h++) g += `<span class="hl">${h % 3 === 0 ? h : ''}</span>`;
  hw.forEach((row, w) => {
    g += `<span class="wl">${WD[w]}</span>`;
    row.forEach((v, h) => {
      const a = v ? (0.12 + 0.88 * Math.sqrt(v / max)).toFixed(3) : 0.04;
      g += `<i style="--a:${a}" title="${WD_LONG[w].slice(0, -1)} ${hourLabel(h)}: ${fmtDur(v)}"></i>`;
    });
  });
  $('#hourWeek').innerHTML = g + '</div>';
}

function renderTops(P) {
  const lists = [
    ['artists', '#topArtists', agg(P, p => p.artist)],
    ['tracks', '#topTracks', agg(P, trackKey)],
    ['albums', '#topAlbums', agg(P, albumKey)]
  ];
  for (const [kind, sel, arr] of lists) {
    const n = state.topN[kind];
    const sorted = sortAgg(arr);
    const top = sorted.slice(0, n);
    const max = top.length ? Math.max(1, val(top[0])) : 1;
    const other = a => (isPlays() ? fmtDur(a.time) : `${a.plays.toLocaleString()} plays`);
    const html = top.map((a, i) => {
      const p = a.p;
      let name, sub;
      if (kind === 'artists') { name = a.key; sub = other(a); }
      else if (kind === 'tracks') { name = p.title; sub = `${p.artist} · ${other(a)}`; }
      else { name = p.album; sub = `${p.artist} · ${other(a)}`; }
      const v = isPlays() ? `${a.plays.toLocaleString()}` : fmtDur(a.time);
      return `<li data-artist="${esc(p.artist)}" title="${esc(name)}"><span class="rk">${i + 1}</span>${art(p.art)}<div class="nm"><b>${esc(name)}</b><small>${esc(sub)}</small><span class="bar" style="width:${(val(a) / max * 100).toFixed(1)}%"></span></div><span class="v">${v}</span></li>`;
    }).join('') || '<li class="muted">Nothing here yet.</li>';
    const el = $(sel);
    el.innerHTML = html;
    const panel = el.parentElement;
    panel.querySelector('button.more')?.remove();
    if (sorted.length > 10) {
      const b = document.createElement('button');
      b.className = 'more';
      b.dataset.kind = kind;
      b.textContent = n > 10 ? 'Show less' : `Show top ${Math.min(50, sorted.length)}`;
      panel.appendChild(b);
    }
  }
}

function renderDiscovery(P, B) {
  const fa = new Map(), ft = new Map();
  for (const p of ALL) {
    if (!fa.has(p.artist)) fa.set(p.artist, p);
    const k = trackKey(p);
    if (!ft.has(k)) ft.set(k, p.t);
  }
  const newA = [...fa.values()].filter(p => p.t >= B.from && p.t <= B.to);
  const newT = [...ft.values()].filter(t => t >= B.from && t <= B.to).length;
  const total = sum(P, p => p.d) || 1;
  const newTime = sum(P.filter(p => ft.get(trackKey(p)) >= B.from), p => p.d);
  const artTime = new Map();
  for (const p of P) artTime.set(p.artist, (artTime.get(p.artist) || 0) + p.d);

  // New artists per month (up to 24 months ending at the range end)
  const months = [];
  const endM = new Date(B.to); endM.setDate(1); endM.setHours(0, 0, 0, 0);
  const firstM = new Date(ALL[0].t); firstM.setDate(1); firstM.setHours(0, 0, 0, 0);
  const cur = new Date(endM);
  while (cur >= firstM && months.length < 24) { months.unshift(monthKey(cur.getTime())); cur.setMonth(cur.getMonth() - 1); }
  const perM = new Map(months.map(m => [m, 0]));
  for (const p of fa.values()) { const k = monthKey(p.t); if (perM.has(k)) perM.set(k, perM.get(k) + 1); }

  const recent = newA.sort((a, b) => b.t - a.t).slice(0, 8);
  $('#discovery').innerHTML = `
    <div class="kv">
      <div><b>${newA.length.toLocaleString()}</b><span>new artists</span></div>
      <div><b>${newT.toLocaleString()}</b><span>new tracks</span></div>
      <div><b>${pct(newTime / total)}</b><span>of time on new tracks</span></div>
    </div>
    <h3>New artists per month</h3>
    ${barChart(months.map(m => ({ v: perM.get(m), label: MON[+m.split('-')[1] - 1], tip: `${monthLabel(m)}: ${perM.get(m)} new artists` })), { h: 150, w: 600, every: months.length > 12 ? 2 : 1 })}
    ${recent.length ? `<h3>Recently discovered</h3><div class="mini-list">${recent.map(p =>
      `<div data-artist="${esc(p.artist)}">${art(p.art, 'sm round')}<div class="nm"><b>${esc(p.artist)}</b><small>first heard ${esc(fmtShortDate(p.t))} via “${esc(p.title)}”</small></div><span class="v">${fmtDur(artTime.get(p.artist) || 0)}</span></div>`).join('')}</div>` : ''}`;
}

function renderRecords(P) {
  if (!P.length) { $('#records').innerHTML = '<p class="muted">No listening in this period.</p>'; return; }
  const byDay = new Map();
  for (const p of P) byDay.set(dayKey(p.t), (byDay.get(dayKey(p.t)) || 0) + p.d);
  let bigDay = null;
  for (const [k, v] of byDay) if (!bigDay || v > bigDay[1]) bigDay = [k, v];

  const byMonth = new Map();
  for (const p of P) byMonth.set(monthKey(p.t), (byMonth.get(monthKey(p.t)) || 0) + p.d);
  let bigMonth = null;
  for (const [k, v] of byMonth) if (!bigMonth || v > bigMonth[1]) bigMonth = [k, v];

  const S = sessions(P);
  const longS = S.reduce((m, s) => (!m || s.time > m.time ? s : m), null);

  const plays = P.filter(isPlay);
  let run = null, cur = null;
  for (const p of plays) {
    if (cur && cur.artist === p.artist) cur.n++;
    else cur = { artist: p.artist, n: 1, t: p.t };
    if (!run || cur.n > run.n) run = { ...cur };
  }

  const perDayTrack = new Map();
  for (const p of plays) { const k = dayKey(p.t) + '|' + trackKey(p); perDayTrack.set(k, (perDayTrack.get(k) || 0) + 1); }
  let obs = null;
  for (const [k, n] of perDayTrack) if (!obs || n > obs[1]) obs = [k, n];

  const first = P[0];
  const rows = [
    ['Biggest day', fmtDur(bigDay[1]), fmtDate(new Date(bigDay[0] + 'T00:00:00').getTime())],
    ['Biggest month', fmtDur(bigMonth[1]), monthLabel(bigMonth[0])],
    ['Longest session', fmtDur(longS.time), `${longS.n} tracks · ${fmtDateTime(longS.start)}`]
  ];
  if (obs && obs[1] > 1) {
    const [day, tk] = obs[0].split('|');
    const [title, artist] = tk.split('\u0001');
    rows.push(['Most plays in a day', `“${title}” × ${obs[1]}`, `${artist} · ${fmtShortDate(new Date(day + 'T00:00:00').getTime())}`]);
  }
  if (run && run.n > 1) rows.push(['Longest artist run', `${run.n} ${run.artist} tracks in a row`, fmtDateTime(run.t)]);
  rows.push(['First track in period', first.title, `${first.artist} · ${fmtDateTime(first.t)}`]);
  $('#records').innerHTML = rows.map(([l, b, s]) => `<div class="rec"><span>${l}</span><div><b>${esc(b)}</b><small>${esc(s)}</small></div></div>`).join('');
}

function renderMonthly(P) {
  const groups = new Map();
  for (const p of P) { const k = monthKey(p.t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const keys = [...groups.keys()].sort().reverse().slice(0, 24);
  if (!keys.length) { $('#monthly').innerHTML = '<p class="muted">No listening in this period.</p>'; return; }
  const rows = keys.map(k => {
    const g = groups.get(k);
    const a = sortAgg(agg(g, p => p.artist))[0];
    const t = sortAgg(agg(g, trackKey))[0];
    return `<tr><td class="n">${monthLabel(k)}</td><td class="n">${fmtDur(sum(g, p => p.d))}</td><td class="n">${g.filter(isPlay).length.toLocaleString()}</td>
      <td><div class="cell" data-artist="${esc(a.key)}" style="cursor:pointer">${art(a.p.art, 'sm round')}<span>${esc(a.key)}</span></div></td>
      <td><div class="cell">${art(t.p.art, 'sm')}<div class="nm"><b>${esc(t.p.title)}</b><small>${esc(t.p.artist)}</small></div></div></td></tr>`;
  }).join('');
  $('#monthly').innerHTML = `<table><thead><tr><th>Month</th><th>Time</th><th>Plays</th><th>#1 artist</th><th>#1 track</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderHistory(P) {
  const q = ($('#histSearch').value || '').trim().toLowerCase();
  let list = P.slice().reverse();
  if (q) list = list.filter(p => `${p.title} ${p.artist} ${p.album}`.toLowerCase().includes(q));
  const shown = list.slice(0, state.histN);
  const rows = shown.map(p => `<tr>
      <td class="n">${esc(fmtDateTime(p.t))}</td>
      <td><div class="cell">${art(p.art, 'sm')}<div class="nm"><b>${esc(p.title)}</b><small data-artist="${esc(p.artist)}" style="cursor:pointer">${esc(p.artist)}</small></div></div></td>
      <td class="muted">${esc(p.album)}</td>
      <td class="n">${fmtDur(p.d)}${p.len ? ' / ' + fmtDur(p.len) : ''}</td>
      <td>${p.est ? '<span class="chip est">estimated</span>' : isPlay(p) ? '<span class="chip play">play</span>' : '<span class="chip">skip</span>'}</td>
    </tr>`).join('');
  $('#history').innerHTML = shown.length
    ? `<table><thead><tr><th>When</th><th>Track</th><th>Album</th><th>Listened</th><th></th></tr></thead><tbody>${rows}</tbody></table>
       ${list.length > shown.length ? `<button class="more" id="histMore">Show more (${(list.length - shown.length).toLocaleString()} left)</button>` : ''}`
    : '<p class="muted">No matching history.</p>';
}

// ---------- artist detail ----------
function openArtist(name) {
  const P = ALL.filter(p => p.artist === name);
  if (!P.length) return;
  const time = sum(P, p => p.d);
  const plays = P.filter(isPlay).length;
  const tracks = agg(P, trackKey).sort((a, b) => b.plays - a.plays || b.time - a.time);
  const latestArt = (P.slice().reverse().find(p => p.art) || {}).art;
  const allTime = sum(ALL, p => p.d) || 1;
  const allArtists = agg(ALL, p => p.artist).sort((a, b) => b.time - a.time);
  const rank = allArtists.findIndex(a => a.key === name) + 1;

  const months = [];
  const endM = new Date(); endM.setDate(1); endM.setHours(0, 0, 0, 0);
  const firstM = new Date(P[0].t); firstM.setDate(1); firstM.setHours(0, 0, 0, 0);
  const c = new Date(endM);
  while (c >= firstM && months.length < 24) { months.unshift(monthKey(c.getTime())); c.setMonth(c.getMonth() - 1); }
  const perM = new Map(months.map(m => [m, 0]));
  for (const p of P) { const k = monthKey(p.t); if (perM.has(k)) perM.set(k, perM.get(k) + p.d); }

  const dlg = $('#detail');
  dlg.innerHTML = `
    <div class="dlg-head">${art(latestArt, 'round')}<div><div class="muted small">Artist · all time · #${rank} overall</div><h2>${esc(name)}</h2></div><button class="close" id="dlgClose">Close</button></div>
    <div class="dlg-body">
      <div class="kv">
        <div><b>${fmtDur(time)}</b><span>listened (${pct(time / allTime)} of all)</span></div>
        <div><b>${plays.toLocaleString()}</b><span>plays</span></div>
        <div><b>${tracks.length}</b><span>different tracks</span></div>
        <div><b>${esc(fmtShortDate(P[0].t))}</b><span>first heard</span></div>
        <div><b>${esc(fmtShortDate(P[P.length - 1].t))}</b><span>last heard</span></div>
      </div>
      <h3>Listening per month</h3>
      ${barChart(months.map(m => ({ v: perM.get(m) / 3600, label: MON[+m.split('-')[1] - 1], tip: `${monthLabel(m)}: ${fmtDur(perM.get(m))}` })), { h: 150, w: 660, fmt: hrs, every: months.length > 12 ? 2 : 1 })}
      <h3>Top tracks</h3>
      <div class="mini-list">${tracks.slice(0, 15).map(a =>
        `<div>${art(a.p.art, 'sm')}<div class="nm"><b>${esc(a.p.title)}</b><small>${esc(a.p.album || '')}</small></div><span class="v">${a.plays} plays · ${fmtDur(a.time)}</span></div>`).join('')}</div>
    </div>`;
  dlg.showModal();
}

// ---------- data import / export ----------
function download(name, text, type) {
  if (window.AndroidBridge) { window.AndroidBridge.saveFile(name, text, type); return; }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
const msg = t => { $('#dataMsg').textContent = t; };

function fromTakeout(arr) {
  const out = [];
  for (const e of arr) {
    if (!e || e.header !== 'YouTube Music' || !e.time || !e.title) continue;
    const t = Date.parse(e.time);
    if (!isFinite(t)) continue;
    const title = String(e.title).replace(/^Watched\s+/, '');
    const artist = (e.subtitles && e.subtitles[0] && e.subtitles[0].name || 'Unknown artist').replace(/\s+-\s+Topic$/, '');
    let vid = '';
    try { vid = new URL(e.titleUrl).searchParams.get('v') || ''; } catch { /* ignore */ }
    out.push({ id: `to_${t}_${vid || title}`, t, e: t + 180000, d: 180, title, artist, album: '', len: 0, vid, art: '', est: 1 });
  }
  return out;
}

async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    let plays;
    if (Array.isArray(data) && data.length && data[0] && 'header' in data[0]) plays = fromTakeout(data);
    else plays = Array.isArray(data) ? data : data.plays;
    if (!Array.isArray(plays) || !plays.length) { msg('No listening data found in that file.'); return; }
    msg(`Importing ${plays.length.toLocaleString()} entries…`);
    const r = await chrome.runtime.sendMessage({ type: 'import', plays });
    msg(r && r.ok ? `Imported ${r.added.toLocaleString()} new entries (${(plays.length - r.added).toLocaleString()} already existed or were invalid).` : `Import failed: ${(r && r.error) || 'unknown error'}`);
    await load();
  } catch (e) {
    msg('Could not read that file: ' + e.message);
  }
}

// ---------- events ----------
document.addEventListener('click', e => {
  const t = e.target;
  if (t.id === 'dlgClose' || t === $('#detail')) { $('#detail').close(); return; }
  const mb = t.closest('#metric button');
  if (mb) { state.metric = mb.dataset.m; persist(); render(); return; }
  if (t.matches('button.more[data-kind]')) { const k = t.dataset.kind; state.topN[k] = state.topN[k] > 10 ? 10 : 50; render(); return; }
  if (t.id === 'histMore') { state.histN += 200; render(); return; }
  const a = t.closest('[data-artist]');
  if (a) openArtist(a.dataset.artist);
});
$('#range').addEventListener('change', e => { state.range = e.target.value; state.histN = 50; persist(); render(); });
let searchT;
$('#histSearch').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => { state.histN = 50; render(); }, 200); });

$('#exportJson').addEventListener('click', () => {
  download(`ytm-stats-backup-${stamp()}.json`, JSON.stringify({ app: 'ytm-stats', version: 1, exported: new Date().toISOString(), plays: ALL }), 'application/json');
});
$('#exportCsv').addEventListener('click', () => {
  const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = [['start', 'end', 'seconds_listened', 'counted_as_play', 'title', 'artist', 'album', 'track_length', 'video_id'].join(',')];
  for (const p of ALL) rows.push([new Date(p.t).toISOString(), new Date(p.e || p.t).toISOString(), p.d, isPlay(p) ? 1 : 0, q(p.title), q(p.artist), q(p.album), p.len || '', p.vid || ''].join(','));
  download(`ytm-stats-${stamp()}.csv`, rows.join('\n'), 'text/csv');
});
$('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
$('#clearData').addEventListener('click', async () => {
  if (!confirm('Delete ALL listening data? This cannot be undone. Consider exporting a backup first.')) return;
  await chrome.runtime.sendMessage({ type: 'clear' });
  msg('All listening data deleted.');
  await load();
});

// Live updates while YouTube Music is playing in another tab.
let reloadT;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !Object.keys(changes).some(k => k.startsWith('p_'))) return;
  clearTimeout(reloadT);
  reloadT = setTimeout(load, 3000);
});

load();
