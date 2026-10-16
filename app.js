'use strict';
(() => {
  const D = window.STUDY_DATA;

  if (!D || !D.days || !D.units) {
    document.body.innerHTML =
      '<div class="container"><div class="callout">Could not load the study data (<code>data.js</code>).' +
      ' Keep <code>index.html</code>, <code>styles.css</code>, <code>app.js</code> and <code>data.js</code> in the same folder.</div></div>';
    return;
  }

  const $ = id => document.getElementById(id);

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  /* ---------------------------------------------------------------- data maps */

  const days = D.days;
  const units = D.units;
  const dayById = new Map(days.map(d => [d.id, d]));
  const unitById = new Map(units.map(u => [u.id, u]));
  const courseById = new Map(D.courses.map(c => [c.code, c]));
  const resourceById = new Map(D.resources.items.map(r => [r.id, r]));
  const libraryById = new Map(Object.entries(D.resources.library));
  const netById = new Map([...D.netPackets.paper1, ...D.netPackets.paper2].map(p => [p.id, p]));

  const AUDIT = [
    { id: 'AUDIT-UNITS', title: 'Audit all 241 IGNOU units', detail: 'Check completion against evidence, or record every unfinished unit ID in the notes.' },
    { id: 'AUDIT-NET', title: 'Audit the full NET syllabus', detail: 'Check all official clauses, or list the unfinished packets and clauses in the notes.' },
    { id: 'AUDIT-BACKUP', title: 'Save a current progress backup', detail: 'Export JSON or Markdown and confirm it is the latest copy.' }
  ];

  const reviewSessionIds = [];
  for (const d of days) {
    for (const k of ['am', 'pm', 'net1', 'net2']) {
      if (d[k] && d[k].id && /^R-/.test(d[k].id)) reviewSessionIds.push(d[k].id);
    }
  }

  const knownChecks = new Set([
    ...units.map(u => u.id),
    ...netById.keys(),
    ...reviewSessionIds,
    ...days.map(d => 'NIGHT-' + d.id),
    ...days.map(d => 'CHANT-' + d.id), // legacy; accepted on import, superseded by rounds
    ...AUDIT.map(a => a.id)
  ]);

  const dayIdSet = new Set(days.map(d => d.id));

  function findTitle(id) {
    if (netById.has(id)) return netById.get(id).title;
    for (const d of days) {
      for (const k of ['am', 'pm', 'net1', 'net2']) {
        if (d[k] && d[k].id === id) return d[k].title;
      }
    }
    return id;
  }

  /* ---------------------------------------------------------------- state */

  const STORAGE_KEY = 'study-companion:' + D.id;
  const isPlain = x => x !== null && typeof x === 'object' && !Array.isArray(x);

  function defaultState() {
    return {
      schemaVersion: 3,
      planId: D.id,
      updatedAt: new Date().toISOString(),
      checks: {}, notes: {}, scores: {}, rounds: {}, research: {}
    };
  }

  function validateState(x) {
    if (!isPlain(x)) throw new Error('This is not a progress file.');
    if (x.planId !== D.id) throw new Error('This backup belongs to a different plan.');
    const v = x.schemaVersion;
    if (![1, 2, 3].includes(v)) throw new Error('Unsupported backup version.');
    if (typeof x.updatedAt !== 'string' || !Number.isFinite(Date.parse(x.updatedAt))) throw new Error('The backup has an invalid date.');
    if (!isPlain(x.checks) || !isPlain(x.notes) || !isPlain(x.scores)) throw new Error('The backup is missing progress fields.');

    for (const [k, val] of Object.entries(x.checks)) {
      if (!knownChecks.has(k) || typeof val !== 'boolean') throw new Error('Unknown or invalid checkbox: ' + k);
    }
    for (const [k, val] of Object.entries(x.notes)) {
      if (!dayIdSet.has(k) || typeof val !== 'string' || val.length > 50000) throw new Error('Invalid day notes.');
    }
    for (const [k, val] of Object.entries(x.scores)) {
      if (!dayIdSet.has(k) || !isPlain(val) ||
          !Number.isInteger(val.attempted) || !Number.isInteger(val.correct) ||
          val.correct < 0 || val.attempted < 0 || val.attempted > 10000 || val.correct > val.attempted) {
        throw new Error('Invalid practice scores.');
      }
    }

    const rounds = v === 1 ? {} : x.rounds; // v1 carries no round counts
    if (!isPlain(rounds)) throw new Error('Missing round counts.');
    for (const [k, val] of Object.entries(rounds)) {
      if (!dayIdSet.has(k) || !Number.isInteger(val) || val < 0 || val > 10000) throw new Error('Invalid round count.');
    }

    const research = x.research || {};
    if (!isPlain(research)) throw new Error('Invalid research notes.');
    for (const [k, val] of Object.entries(research)) {
      if (!dayIdSet.has(k) || typeof val !== 'string' || val.length > 50000) throw new Error('Invalid research note.');
    }

    return { schemaVersion: 3, planId: D.id, updatedAt: x.updatedAt, checks: x.checks, notes: x.notes, scores: x.scores, rounds, research };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return validateState(JSON.parse(raw));
    } catch (e) {
      console.warn('Discarding unreadable local state:', e);
    }
    return defaultState();
  }

  let state = loadState();
  let pendingImport = null;

  /* ---------------------------------------------------------------- time (IST) */

  function istNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: D.timezone }));
  }
  function istDateString() {
    const d = istNow();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function clockNow() {
    const d = istNow();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function resolveTodayId() {
    const t = istDateString();
    const exact = days.find(d => d.date === t);
    if (exact) return exact.id;
    if (t < days[0].date) return days[0].id;
    if (t > days[days.length - 1].date) return days[days.length - 1].id;
    let best = days[0].id;
    for (const d of days) { if (d.date <= t) best = d.id; else break; }
    return best;
  }

  function dayIndex(id) { return days.findIndex(d => d.id === id); }
  function daysLeft(dateStr) {
    return Math.max(0, Math.round((Date.parse(D.end + 'T00:00:00Z') - Date.parse(dateStr + 'T00:00:00Z')) / 86400000));
  }

  /* ---------------------------------------------------------------- persistence */

  function setSaveStatus(kind) {
    const badge = $('save-badge');
    const text = $('save-badge-text');
    badge.classList.remove('is-saved', 'is-error');
    if (kind === 'saved') { badge.classList.add('is-saved'); text.textContent = 'Saved · ' + clockNow(); }
    else if (kind === 'error') { badge.classList.add('is-error'); text.textContent = 'Could not save'; }
    else { text.textContent = 'Saved on this device only'; }
  }

  function persist() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSaveStatus('saved');
    } catch (e) {
      setSaveStatus('error');
      console.warn('Could not save to local storage:', e);
    }
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-visible'), 2600);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ---------------------------------------------------------------- progress maths */

  function streamCounts() {
    const done = id => !!state.checks[id];
    const y1 = units.filter(u => u.year === 1);
    const y2 = units.filter(u => u.year === 2);
    const n1 = D.netPackets.paper1;
    const n2 = D.netPackets.paper2;
    return {
      year1: { done: y1.filter(u => done(u.id)).length, total: y1.length },
      year2: { done: y2.filter(u => done(u.id)).length, total: y2.length },
      net1: { done: n1.filter(p => done(p.id)).length, total: n1.length },
      net2: { done: n2.filter(p => done(p.id)).length, total: n2.length }
    };
  }

  /* ---------------------------------------------------------------- shared widgets */

  function resourceLinks(id) {
    const r = resourceById.get(id);
    if (!r) return '';
    const chips = [];
    const core = (r.core || [])[0];
    if (core && core.url) chips.push(`<a class="link-chip" href="${esc(core.url)}" target="_blank" rel="noopener noreferrer">${esc(core.label || 'Unit PDF')}</a>`);
    const v = r.video;
    if (v && v.links && v.links.length) {
      const l = v.links[0];
      chips.push(`<a class="link-chip link-chip--gold" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || 'Lecture')}</a>`);
    }
    return chips.join('');
  }

  function taskRow(id) {
    const checked = !!state.checks[id];
    const u = unitById.get(id);
    let title, meta, links;
    if (u) {
      title = u.title;
      meta = `<span class="task__id">${esc(id)}</span>`;
      links = resourceLinks(id);
    } else {
      title = findTitle(id);
      meta = '';
      links = resourceLinks(id);
    }
    return `<li class="task${checked ? ' is-done' : ''}" data-unit-id="${esc(id)}">
      <label class="task__label">
        <input type="checkbox" class="task__check" data-check="${esc(id)}" ${checked ? 'checked' : ''}>
        <span class="task__body">
          <span class="task__title">${esc(title)}</span>
          ${meta ? `<span class="task__meta">${meta}</span>` : ''}
          ${links ? `<span class="task__links">${links}</span>` : ''}
        </span>
      </label>
    </li>`;
  }

  function reviewRow(id) {
    const checked = !!state.checks[id];
    return `<li class="task${checked ? ' is-done' : ''}">
      <label class="task__label">
        <input type="checkbox" class="task__check" data-check="${esc(id)}" ${checked ? 'checked' : ''}>
        <span class="task__body"><span class="task__title">Completed this review session</span></span>
      </label>
    </li>`;
  }

  /* ---------------------------------------------------------------- Today view */

  const SLOTS = {
    am: { label: '10:00 – 12:00 · Year 1', kind: 'course' },
    net1: { label: '12:10 – 12:55 · NET Paper I', kind: 'net' },
    pm: { label: '15:00 – 17:00 · Year 2', kind: 'course' },
    net2: { label: '17:10 – 17:55 · NET Paper II', kind: 'net' }
  };

  let selectedDayId = resolveTodayId();

  function renderChant(id) {
    const n = state.rounds[id] || 0;
    $('chant-value').textContent = n;
    $('chant-number').value = n || '';
    const goal = $('chant-goal');
    if (n >= D.chantingTarget) { goal.textContent = 'Target met'; goal.className = 'pill pill--done'; }
    else { goal.textContent = (D.chantingTarget - n) + ' to go'; goal.className = 'pill pill--gold'; }
  }

  function renderStats() {
    const c = streamCounts();
    const cards = [
      { label: 'IGNOU · Year 1', gold: false, ...c.year1 },
      { label: 'IGNOU · Year 2', gold: false, ...c.year2 },
      { label: 'NET · Paper I', gold: true, ...c.net1 },
      { label: 'NET · Paper II', gold: true, ...c.net2 }
    ];
    $('stats').innerHTML = cards.map(s => {
      const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
      return `<div class="stat-card${s.gold ? ' stat-card--gold' : ''}">
        <div class="stat-card__label">${esc(s.label)}</div>
        <div class="stat-card__value">${s.done}<small> / ${s.total}</small></div>
        <div class="stat-card__bar"><div class="stat-card__bar-fill" style="width:${pct}%"></div></div>
        <div class="stat-card__note">${s.done === s.total ? 'First pass complete' : (s.total - s.done) + ' left'}</div>
      </div>`;
    }).join('');
  }

  function sessionCard(key, s) {
    if (!s) return '';
    const slot = SLOTS[key];
    const isNet = slot.kind === 'net';
    const unitTasks = (s.unitIds && s.unitIds.length) ? s.unitIds : [];
    const isReview = !isNet && unitTasks.length === 0;
    const taskIds = unitTasks.length ? unitTasks : (s.id ? [s.id] : []);
    const done = taskIds.filter(id => state.checks[id]).length;
    const total = taskIds.length;

    const countPill = total
      ? `<span class="pill ${done === total ? 'pill--done' : 'pill--muted'}">${done}/${total}</span>`
      : '';

    let detailHtml = '';
    if (s.detail) {
      if (isReview) detailHtml = `<p class="session__detail">${esc(s.detail)}</p>`;
      else detailHtml = `<details class="session__detail-wrap"><summary>What to cover</summary><p class="session__detail">${esc(s.detail)}</p></details>`;
    }

    const tasksHtml = taskIds.map(id => (unitTasks.length || isNet) ? taskRow(id) : reviewRow(id)).join('');

    return `<article class="session${isNet ? ' session--net' : ''}">
      <div class="session__head">
        <div>
          <div class="session__slot">${esc(slot.label)}</div>
          <h3 class="session__title">${esc(s.title)}</h3>
          ${detailHtml}
        </div>
        <div class="session__count">${countPill}</div>
      </div>
      ${tasksHtml ? `<ul class="task-list">${tasksHtml}</ul>` : ''}
    </article>`;
  }

  function renderSessions(day) {
    $('sessions').innerHTML = ['am', 'net1', 'pm', 'net2'].map(k => sessionCard(k, day[k])).join('');
  }

  function renderNight(day, id) {
    $('night-prompt').textContent = day.night || 'Pick one question, source or argument; keep a short note.';
    $('night-check').checked = !!state.checks['NIGHT-' + id];
    $('night-note').value = state.research[id] || '';
  }

  function renderNotesScore(id) {
    $('day-notes').value = state.notes[id] || '';
    const sc = state.scores[id] || {};
    $('score-attempted').value = sc.attempted ?? '';
    $('score-correct').value = sc.correct ?? '';
    $('score-error').textContent = '';
    $('score-error').classList.remove('is-error');
    updateAccuracy();
  }

  function updateAccuracy() {
    const av = $('score-attempted').value;
    const cv = $('score-correct').value;
    const a = parseInt(av, 10);
    const c = parseInt(cv, 10);
    const el = $('accuracy');
    if (av === '' && cv === '') { el.textContent = ''; return; }
    if (!Number.isInteger(a) || !Number.isInteger(c) || a < 0 || c < 0 || c > a) {
      el.textContent = av || cv ? '—' : '';
      return;
    }
    if (a === 0) { el.textContent = ''; return; }
    el.textContent = c + '/' + a + ' · ' + Math.round(c / a * 100) + '%';
  }

  function saveScore(id) {
    const av = $('score-attempted').value;
    const cv = $('score-correct').value;
    const a = parseInt(av, 10);
    const c = parseInt(cv, 10);
    const errEl = $('score-error');
    errEl.textContent = '';
    errEl.classList.remove('is-error');
    if (av === '' && cv === '') { delete state.scores[id]; persist(); updateAccuracy(); return; }
    if (!Number.isInteger(a) || !Number.isInteger(c) || a < 0 || c < 0 || a > 10000 || c > a) {
      errEl.textContent = 'Attempted must be a whole number ≥ 0, and correct must be between 0 and attempted.';
      errEl.classList.add('is-error');
      updateAccuracy();
      return;
    }
    state.scores[id] = { attempted: a, correct: c };
    persist();
    updateAccuracy();
  }

  function renderAudit(id) {
    const isLast = id === days[days.length - 1].id;
    $('audit-card').hidden = !isLast;
    if (!isLast) return;
    $('audit-list').innerHTML = AUDIT.map(a => {
      const checked = !!state.checks[a.id];
      return `<li class="task${checked ? ' is-done' : ''}">
        <label class="task__label">
          <input type="checkbox" class="task__check" data-check="${esc(a.id)}" ${checked ? 'checked' : ''}>
          <span class="task__body">
            <span class="task__title">${esc(a.title)}</span>
            <span class="task__meta">${esc(a.detail)}</span>
          </span>
        </label>
      </li>`;
    }).join('');
  }

  function populateDaySelect() {
    const sel = $('day-select');
    sel.innerHTML = days.map(d => `<option value="${esc(d.id)}">${esc(d.label)}${d.review ? ' · repair' : ''}</option>`).join('');
    sel.value = selectedDayId;
  }

  function renderFooterSummary() {
    const c = streamCounts();
    const done = c.year1.done + c.year2.done + c.net1.done + c.net2.done;
    const total = c.year1.total + c.year2.total + c.net1.total + c.net2.total;
    $('footer-summary').textContent =
      'First pass: ' + done + ' of ' + total + ' items covered (' + (total ? Math.round(done / total * 100) : 0) + '%). Chanting and research are tracked separately.';
  }

  function renderToday() {
    if (!dayById.has(selectedDayId)) selectedDayId = resolveTodayId();
    const id = selectedDayId;
    const idx = dayIndex(id);
    const day = dayById.get(id);
    const left = daysLeft(day.date);

    $('day-kicker').textContent = 'Day ' + (idx + 1) + ' of ' + days.length;
    $('today-h').textContent = day.review ? 'Repair day' : 'Your study day';
    $('day-sub').textContent = day.date + ' · ' + day.label + ' · ' +
      (day.review ? 'catch up and recall' : (left === 0 ? 'final coverage audit' : left + ' days left in the first pass'));

    populateDaySelect();
    renderChant(id);
    renderStats();
    renderSessions(day);
    renderNight(day, id);
    renderNotesScore(id);
    renderAudit(id);
    renderFooterSummary();
  }

  function gotoDay(id) {
    if (!dayById.has(id)) return;
    selectedDayId = id;
    renderToday();
  }

  function offsetDay(delta) {
    const idx = dayIndex(selectedDayId) + delta;
    return days[Math.max(0, Math.min(days.length - 1, idx))].id;
  }

  /* ---------------------------------------------------------------- Syllabus view */

  let syllabusStream = 'year1';
  let syllabusCourse = '';
  let syllabusSearch = '';

  function populateCourseFilter(stream) {
    const sel = $('syllabus-course');
    const yr = stream === 'year1' ? 1 : stream === 'year2' ? 2 : null;
    let opts = '<option value="">All courses</option>';
    if (yr) {
      D.courses.filter(c => c.year === yr).forEach(c => {
        opts += `<option value="${esc(c.code)}">${esc(c.title)}</option>`;
      });
      sel.disabled = false;
    } else {
      sel.disabled = true;
    }
    sel.innerHTML = opts;
    sel.value = syllabusCourse || '';
  }

  function courseGroup(c) {
    if (syllabusCourse && syllabusCourse !== c.code) return '';
    const courseUnits = units.filter(u => u.course === c.code).sort((a, b) => a.block - b.block || a.position - b.position);
    const q = syllabusSearch.trim().toLowerCase();
    const filtered = courseUnits.filter(u => !q || u.title.toLowerCase().includes(q) || u.id.toLowerCase().includes(q));
    if (!filtered.length && q) return '';

    const done = courseUnits.filter(u => state.checks[u.id]).length;
    const total = courseUnits.length;
    const pct = total ? Math.round(done / total * 100) : 0;

    const blocks = new Map();
    for (const u of filtered) {
      if (!blocks.has(u.block)) blocks.set(u.block, []);
      blocks.get(u.block).push(u);
    }
    const blockHtml = [...blocks.entries()].map(([b, us]) => `
      <div class="block">
        <div class="block__label">Block ${b}</div>
        <div class="block__units">${us.map(u => taskRow(u.id)).join('')}</div>
      </div>`).join('');

    return `<section class="course-group" data-course="${esc(c.code)}">
      <div class="course-group__head">
        <div><span class="course-group__name">${esc(c.title)}</span><span class="course-group__code">${esc(c.code)}</span></div>
        <div class="course-group__bar" aria-hidden="true"><div class="course-group__bar-fill" style="width:${pct}%"></div></div>
        <span class="pill pill--muted">${done}/${total}</span>
      </div>
      <div class="course-group__body">${blockHtml}</div>
    </section>`;
  }

  function netGroup(paper, title) {
    const packets = D.netPackets[paper];
    const q = syllabusSearch.trim().toLowerCase();
    const filtered = packets.filter(p => !q || p.title.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
    if (!filtered.length) return '';

    const done = packets.filter(p => state.checks[p.id]).length;
    const total = packets.length;
    const pct = total ? Math.round(done / total * 100) : 0;

    const rows = filtered.map(p => {
      const checked = !!state.checks[p.id];
      const chips = resourceLinks(p.id);
      return `<li class="task${checked ? ' is-done' : ''}" data-unit-id="${esc(p.id)}">
        <label class="task__label">
          <input type="checkbox" class="task__check" data-check="${esc(p.id)}" ${checked ? 'checked' : ''}>
          <span class="task__body">
            <span class="task__title">${esc(p.title)}</span>
            <span class="task__meta"><span class="task__id">${esc(p.id)}</span></span>
            ${p.detail ? `<details class="session__detail-wrap"><summary>Clauses</summary><p class="session__detail">${esc(p.detail)}</p></details>` : ''}
            ${chips ? `<span class="task__links">${chips}</span>` : ''}
          </span>
        </label>
      </li>`;
    }).join('');

    return `<section class="course-group net-group" data-net="${paper}">
      <div class="course-group__head">
        <div><span class="course-group__name">${esc(title)}</span></div>
        <div class="course-group__bar" aria-hidden="true"><div class="course-group__bar-fill" style="width:${pct}%"></div></div>
        <span class="pill pill--muted">${done}/${total}</span>
      </div>
      <div class="course-group__body"><div class="block__units"><ul class="task-list">${rows}</ul></div></div>
    </section>`;
  }

  function renderSyllabus() {
    populateCourseFilter(syllabusStream);
    let html = '';
    if (syllabusStream === 'year1' || syllabusStream === 'year2') {
      const yr = syllabusStream === 'year1' ? 1 : 2;
      for (const c of D.courses.filter(x => x.year === yr)) html += courseGroup(c);
    } else {
      html = netGroup(syllabusStream === 'net1' ? 'paper1' : 'paper2', syllabusStream === 'net1' ? 'NET · Paper I' : 'NET · Paper II');
    }
    $('syllabus-list').innerHTML = html || '<div class="empty">No items match your search.</div>';
  }

  /* ---------------------------------------------------------------- Reading room */

  let readingStream = 'all';
  let readingSearch = '';

  function streamLabel(stream) {
    return { year1: 'Year 1', year2: 'Year 2', net1: 'NET · Paper I', net2: 'NET · Paper II' }[stream] || stream;
  }

  function resourceCard(it) {
    let html = `<div class="resource__head">
      <div class="resource__title">${esc(it.title)}</div>
      <div class="resource__id">${esc(it.id)} · ${esc(streamLabel(it.stream))}</div>
    </div>`;

    if (it.core && it.core.length) {
      html += '<div class="resource__section"><div class="resource__label">Core reading</div>';
      for (const c of it.core) {
        html += `<div class="resource__row">${esc(c.label)} — ${esc(c.locator || '')}</div>
          <div class="resource__links">${c.url ? `<a class="link-chip" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Open PDF</a>` : ''}
          ${it.landing ? `<a class="link-chip" href="${esc(it.landing)}" target="_blank" rel="noopener noreferrer">Landing page</a>` : ''}</div>`;
      }
      html += '</div>';
    } else if (it.landing) {
      html += `<div class="resource__section"><div class="resource__label">Core reading</div>
        <div class="resource__links"><a class="link-chip" href="${esc(it.landing)}" target="_blank" rel="noopener noreferrer">Open source</a></div></div>`;
    }

    if (it.supplement && it.supplement.length) {
      html += '<div class="resource__section"><div class="resource__label">Primary text / supplement</div>';
      for (const s of it.supplement) {
        html += `<div class="resource__row">${esc(s.label)} — ${esc(s.locator || '')}${s.scope ? ' · ' + esc(s.scope) : ''}</div>
          ${s.url ? `<div class="resource__links"><a class="link-chip" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open</a></div>` : ''}`;
      }
      html += '</div>';
    }

    const v = it.video;
    if (v && ((v.links && v.links.length) || v.playlist || v.course)) {
      const lib = libraryById.get(v.library);
      html += '<div class="resource__section"><div class="resource__label">Lecture</div>';
      if (lib) html += `<div class="resource__row">${esc(lib.title)}${lib.teacher ? ' — ' + esc(lib.teacher) : ''}${lib.institution ? ', ' + esc(lib.institution) : ''}</div>`;
      if (v.selection) html += `<div class="resource__row">Selection: ${esc(v.selection)}${v.scope ? ' · ' + esc(v.scope) : ''}</div>`;
      const links = [];
      for (const l of (v.links || [])) links.push(`<a class="link-chip link-chip--gold" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || 'Lecture')}</a>`);
      if (v.playlist) links.push(`<a class="link-chip" href="${esc(v.playlist)}" target="_blank" rel="noopener noreferrer">Playlist</a>`);
      if (v.course) links.push(`<a class="link-chip" href="${esc(v.course)}" target="_blank" rel="noopener noreferrer">Course</a>`);
      html += `<div class="resource__links">${links.join('')}</div></div>`;
    }

    if (it.warnings && it.warnings.length) html += `<div class="warning">${it.warnings.map(w => esc(w)).join('<br>')}</div>`;
    if (it.verification) html += `<div class="verify">${esc(it.verification)}</div>`;

    return `<article class="resource">${html}</article>`;
  }

  function renderReading() {
    const q = readingSearch.trim().toLowerCase();
    const items = D.resources.items.filter(it => {
      if (readingStream !== 'all' && it.stream !== readingStream) return false;
      if (!q) return true;
      const lib = it.video ? libraryById.get(it.video.library) : null;
      const hay = (it.title + ' ' + it.id + ' ' + (it.core || []).map(c => c.label + ' ' + (c.locator || '')).join(' ') + ' ' + (lib ? lib.title : '')).toLowerCase();
      return hay.includes(q);
    });
    $('reading-list').innerHTML = items.length
      ? items.map(resourceCard).join('')
      : '<div class="empty">No resources match your search.</div>';
  }

  /* ---------------------------------------------------------------- Plan view */

  function planCard(d) {
    const idx = dayIndex(d.id) + 1;
    return `<article class="plan-card${d.review ? ' is-review' : ''}">
      <div class="plan-card__head">
        <span class="plan-card__date">${esc(d.label)}</span>
        <span class="pill ${d.review ? 'pill--gold' : 'pill--muted'}">${d.review ? 'Repair' : 'Day ' + idx}</span>
      </div>
      <div class="plan-card__line"><strong>AM</strong> ${esc(d.am ? d.am.title : '')}</div>
      <div class="plan-card__line"><strong>NET I</strong> ${esc(d.net1 ? d.net1.title : '')}</div>
      <div class="plan-card__line"><strong>PM</strong> ${esc(d.pm ? d.pm.title : '')}</div>
      <div class="plan-card__line"><strong>NET II</strong> ${esc(d.net2 ? d.net2.title : '')}</div>
      <button class="btn btn-ghost plan-card__jump" data-jump="${esc(d.id)}">Open this day →</button>
    </article>`;
  }

  function renderPlan() {
    $('routine').innerHTML = D.routine.map(r =>
      `<div class="routine__row"><span>${esc(r.time)}</span><span>${esc(r.activity)}</span></div>`).join('');
    $('plan-grid').innerHTML = days.map(planCard).join('');
  }

  function renderHelp() {
    $('source-list').innerHTML = D.sources.map(s =>
      `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></li>`).join('');
  }

  /* ---------------------------------------------------------------- view switching */

  const VIEWS = ['today', 'syllabus', 'reading', 'plan', 'help'];
  let currentView = 'today';

  function showView(name) {
    if (!VIEWS.includes(name)) name = 'today';
    currentView = name;
    for (const vn of VIEWS) {
      const panel = document.querySelector(`[data-viewpanel="${vn}"]`);
      if (panel) panel.hidden = vn !== name;
    }
    document.querySelectorAll('[data-view]').forEach(a => {
      if (a.dataset.view === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (name === 'syllabus') renderSyllabus();
    else if (name === 'reading') renderReading();
    else if (name === 'plan') renderPlan();
    else if (name === 'help') renderHelp();
    else renderToday();
    window.scrollTo(0, 0);
  }

  function hashToView() {
    const h = (location.hash || '#today').replace('#', '');
    showView(VIEWS.includes(h) ? h : 'today');
  }
  window.addEventListener('hashchange', hashToView);

  function renderAll() {
    renderStats();
    renderFooterSummary();
    if (currentView === 'syllabus') renderSyllabus();
    else if (currentView === 'reading') renderReading();
    else if (currentView === 'plan') renderPlan();
    else if (currentView === 'help') renderHelp();
    else renderToday();
  }

  /* ---------------------------------------------------------------- targeted refresh after a tick */

  function updateSessionPill(sessionEl) {
    const pill = sessionEl.querySelector('.session__count .pill');
    if (!pill) return;
    const checks = [...sessionEl.querySelectorAll('.task__check')];
    if (!checks.length) return;
    const done = checks.filter(c => c.checked).length;
    pill.textContent = done + '/' + checks.length;
    pill.className = 'pill ' + (done === checks.length ? 'pill--done' : 'pill--muted');
  }

  function updateCourseBars() {
    document.querySelectorAll('[data-course]').forEach(g => {
      const us = units.filter(u => u.course === g.dataset.course);
      const done = us.filter(u => state.checks[u.id]).length;
      const fill = g.querySelector('.course-group__bar-fill');
      if (fill) fill.style.width = (us.length ? Math.round(done / us.length * 100) : 0) + '%';
      const pill = g.querySelector('.course-group__head .pill');
      if (pill) pill.textContent = done + '/' + us.length;
    });
  }

  function updateNetBars() {
    document.querySelectorAll('[data-net]').forEach(g => {
      const packets = D.netPackets[g.dataset.net];
      const done = packets.filter(p => state.checks[p.id]).length;
      const fill = g.querySelector('.course-group__bar-fill');
      if (fill) fill.style.width = (packets.length ? Math.round(done / packets.length * 100) : 0) + '%';
      const pill = g.querySelector('.course-group__head .pill');
      if (pill) pill.textContent = done + '/' + packets.length;
    });
  }

  /* ---------------------------------------------------------------- wire up events */

  // Nav (hash links drive the view).
  document.querySelectorAll('[data-view]').forEach(a => {
    a.addEventListener('click', () => { /* hashchange handles it */ });
  });

  // Day navigation.
  $('day-prev').addEventListener('click', () => gotoDay(offsetDay(-1)));
  $('day-next').addEventListener('click', () => gotoDay(offsetDay(1)));
  $('day-select').addEventListener('change', e => gotoDay(e.target.value));
  $('day-today').addEventListener('click', () => gotoDay(resolveTodayId()));

  // Chanting.
  function setRounds(id, n) {
    n = Math.max(0, Math.min(10000, Math.floor(n) || 0));
    if (n === 0) delete state.rounds[id]; else state.rounds[id] = n;
    persist();
    renderChant(id);
  }
  $('chant-plus').addEventListener('click', () => setRounds(selectedDayId, (state.rounds[selectedDayId] || 0) + 1));
  $('chant-minus').addEventListener('click', () => setRounds(selectedDayId, (state.rounds[selectedDayId] || 0) - 1));
  $('chant-number').addEventListener('change', e => {
    const v = parseInt(e.target.value, 10);
    setRounds(selectedDayId, Number.isFinite(v) ? v : 0);
  });

  // Checkboxes (event delegation).
  document.addEventListener('change', e => {
    const t = e.target;
    if (!t.classList || !t.classList.contains('task__check')) return;
    const id = t.dataset.check;
    if (t.checked) state.checks[id] = true; else delete state.checks[id];
    persist();
    const row = t.closest('.task');
    if (row) row.classList.toggle('is-done', t.checked);
    renderStats();
    renderFooterSummary();
    const session = t.closest('.session');
    if (session) updateSessionPill(session);
    updateCourseBars();
    updateNetBars();
  });

  // Night research.
  $('night-check').addEventListener('change', e => {
    const id = 'NIGHT-' + selectedDayId;
    if (e.target.checked) state.checks[id] = true; else delete state.checks[id];
    persist();
  });
  $('night-note').addEventListener('input', debounce(() => {
    const v = $('night-note').value;
    if (v) state.research[selectedDayId] = v; else delete state.research[selectedDayId];
    persist();
  }, 400));

  // Day notes + scores.
  $('day-notes').addEventListener('input', debounce(() => {
    const v = $('day-notes').value;
    if (v) state.notes[selectedDayId] = v; else delete state.notes[selectedDayId];
    persist();
  }, 400));
  $('score-attempted').addEventListener('input', updateAccuracy);
  $('score-correct').addEventListener('input', updateAccuracy);
  $('score-attempted').addEventListener('change', () => saveScore(selectedDayId));
  $('score-correct').addEventListener('change', () => saveScore(selectedDayId));

  // Segmented controls.
  function setupSegmented(containerId, onChange) {
    const container = $(containerId);
    container.addEventListener('click', e => {
      const btn = e.target.closest('.segmented__btn');
      if (!btn) return;
      container.querySelectorAll('.segmented__btn').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      onChange(btn.dataset.stream);
    });
  }
  setupSegmented('stream-tabs', s => { syllabusStream = s; syllabusCourse = ''; renderSyllabus(); });
  setupSegmented('reading-tabs', s => { readingStream = s; renderReading(); });

  // Search + filters.
  $('syllabus-search').addEventListener('input', debounce(() => { syllabusSearch = $('syllabus-search').value; renderSyllabus(); }, 200));
  $('reading-search').addEventListener('input', debounce(() => { readingSearch = $('reading-search').value; renderReading(); }, 200));
  $('syllabus-course').addEventListener('change', e => { syllabusCourse = e.target.value; renderSyllabus(); });

  // Plan → day jump.
  document.addEventListener('click', e => {
    const jump = e.target.closest('[data-jump]');
    if (!jump) return;
    gotoDay(jump.dataset.jump);
    if (location.hash !== '#today') location.hash = '#today'; else showView('today');
  });

  // Export / import / download.
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  $('export-json').addEventListener('click', () => {
    download('philosophy-progress-' + D.id + '.json', JSON.stringify(state, null, 2), 'application/json');
    toast('Progress exported as JSON.');
  });
  $('export-md').addEventListener('click', () => {
    download('philosophy-checklists-' + D.id + '.md', buildMarkdown(), 'text/markdown');
    toast('Checklist exported as Markdown.');
  });
  $('download-plan').addEventListener('click', () => {
    download('philosophy-study-plan-' + D.id + '.md', D.planMarkdown, 'text/markdown');
    toast('Study plan downloaded.');
  });

  $('import-json').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = validateState(JSON.parse(reader.result));
        pendingImport = parsed;
        const doneChecks = Object.values(parsed.checks).filter(Boolean).length;
        const roundsTotal = Object.values(parsed.rounds).reduce((a, b) => a + b, 0);
        const notes = Object.values(parsed.notes).filter(v => v && v.trim()).length;
        $('import-summary').innerHTML =
          '<p>This backup contains:</p>' +
          '<p>• ' + doneChecks + ' completed item(s)<br>• ' + notes + ' day note(s)<br>• ' + roundsTotal + ' total rounds</p>' +
          '<p>Importing replaces the current progress in this browser.</p>';
        $('import-dialog').showModal();
      } catch (err) {
        toast('Could not import: ' + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });
  $('import-confirm').addEventListener('click', () => {
    if (pendingImport) { state = pendingImport; pendingImport = null; persist(); renderAll(); }
    $('import-dialog').close();
    toast('Progress imported.');
  });
  $('import-cancel').addEventListener('click', () => { pendingImport = null; $('import-dialog').close(); });

  // Reset.
  $('reset-progress').addEventListener('click', () => $('reset-dialog').showModal());
  $('reset-confirm').addEventListener('click', () => {
    state = defaultState();
    persist();
    renderAll();
    $('reset-dialog').close();
    toast('All progress cleared.');
  });
  $('reset-cancel').addEventListener('click', () => $('reset-dialog').close());

  // Dialog backdrop click closes.
  for (const id of ['import-dialog', 'reset-dialog']) {
    $(id).addEventListener('click', e => { if (e.target === $(id)) $(id).close(); });
  }

  /* ---------------------------------------------------------------- markdown export */

  function buildMarkdown() {
    const c = streamCounts();
    const L = [];
    L.push('# Philosophy study progress — ' + D.id);
    L.push('');
    L.push('Exported ' + state.updatedAt);
    L.push('');
    L.push('## Summary');
    L.push('- IGNOU Year 1: ' + c.year1.done + '/' + c.year1.total);
    L.push('- IGNOU Year 2: ' + c.year2.done + '/' + c.year2.total);
    L.push('- NET Paper I: ' + c.net1.done + '/' + c.net1.total);
    L.push('- NET Paper II: ' + c.net2.done + '/' + c.net2.total);
    L.push('');
    L.push('## Rounds per day');
    for (const d of days) {
      const r = state.rounds[d.id] || 0;
      L.push('- [' + (r >= D.chantingTarget ? 'x' : ' ') + '] ' + d.label + ' — ' + r + ' rounds' + (r >= D.chantingTarget ? ' ✓' : ''));
    }
    L.push('');
    L.push('## Checklist');
    const streams = [['year1', 'IGNOU · Year 1', 1], ['year2', 'IGNOU · Year 2', 2], ['net1', 'NET · Paper I', null], ['net2', 'NET · Paper II', null]];
    for (const [key, label, yr] of streams) {
      L.push('### ' + label);
      if (key === 'year1' || key === 'year2') {
        for (const cc of D.courses.filter(x => x.year === yr)) {
          L.push('#### ' + cc.code + ' — ' + cc.title);
          const us = units.filter(u => u.course === cc.code).sort((a, b) => a.block - b.block || a.position - b.position);
          for (const u of us) L.push('- [' + (state.checks[u.id] ? 'x' : ' ') + '] ' + u.id + ' — ' + u.title);
        }
      } else {
        const paper = key === 'net1' ? 'paper1' : 'paper2';
        for (const p of D.netPackets[paper]) L.push('- [' + (state.checks[p.id] ? 'x' : ' ') + '] ' + p.id + ' — ' + p.title);
      }
      L.push('');
    }
    L.push('## Day notes');
    let any = false;
    for (const d of days) {
      if (state.notes[d.id] && state.notes[d.id].trim()) { L.push('### ' + d.label + '\n' + state.notes[d.id]); any = true; }
    }
    if (!any) L.push('_No notes yet._');
    return L.join('\n');
  }

  /* ---------------------------------------------------------------- boot */

  setSaveStatus(null);
  renderHelp();
  hashToView();
})();
