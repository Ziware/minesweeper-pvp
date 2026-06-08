/**
 * Vanilla-JS local log viewer (unified schema).
 *
 * Каждая партия теперь — это директория logs/<mode>/<sess>/ с двумя файлами:
 *   • meta.json       — описание партии (mode, players, IP, config, итог);
 *   • game.log.jsonl  — упрощённый «игровой» лог.
 *
 * Словарь игровых событий ОДИН для PvP и solo:
 *   setup_mine, setup_confirmed, game_started, zone_select,
 *   cell_open, mine_hit, mine_defused, phase3_mine, turn_end, game_finished.
 *
 * Просмотрщик:
 *   • Список сессий (/api/sessions) — фильтрует PvP/solo, группирует по дням.
 *   • Открытие сессии (/api/session/<id>) — строит линейку snapshot'ов и
 *     даёт пошаговое перемещение клавишами/кнопками.
 *   • Поле всегда нарисовано «по-видимому»: владельцы клеток, мины обоих
 *     игроков, цифры — только внутри текущей display 3×3.
 *   • Тоггл «Только игровые ходы» здесь почти не нужен (других событий
 *     просмотрщику не присылают), но оставлен на будущее.
 */

const DEFAULT_CONFIG = {
  boardSize: 10,
  initialMinesRed: 7,
  initialMinesBlue: 9,
  maxLives: 3,
};

const GAME_EVENT_KINDS = new Set([
  'setup_mine',
  'setup_confirmed',
  'game_started',
  'zone_select',
  'cell_open',
  'mine_hit',
  'mine_defused',
  'phase3_mine',
  'turn_end',
  'game_finished',
]);

// ─── DOM helpers ───────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const screenList   = $('#screen-list');
const screenViewer = $('#screen-viewer');
const logListEl    = $('#logList');
const boardEl      = $('#board');
const boardLegend  = $('#boardLegend');
const viewerTitle  = $('#viewerTitle');
const viewerSubtitle = $('#viewerSubtitle');
const stepLabel    = $('#stepLabel');
const statePanel   = $('#statePanel');
const eventPanel   = $('#eventPanel');
const eventList    = $('#eventList');
const btnBack      = $('#btnBack');
const btnRefresh   = $('#btnRefresh');
const btnFirst     = $('#btnFirst');
const btnPrev      = $('#btnPrev');
const btnNext      = $('#btnNext');
const btnLast      = $('#btnLast');
const chkSkipNonGame = $('#chkSkipNonGame');

// ─── Top-level state ───────────────────────────────────────────────────────
let allSnapshots = [];
let visibleSteps = [];
let cursor       = 0;
let currentSession = null;          // {id, meta, events}
let allSessions  = [];              // list from /api/sessions
let listFilter   = 'all';

// ─── Bootstrap ─────────────────────────────────────────────────────────────
btnRefresh.addEventListener('click', loadList);
btnBack.addEventListener('click', showList);
btnFirst.addEventListener('click', () => moveCursor(0));
btnPrev.addEventListener('click',  () => moveCursor(cursor - 1));
btnNext.addEventListener('click',  () => moveCursor(cursor + 1));
btnLast.addEventListener('click',  () => moveCursor(visibleSteps.length - 1));
chkSkipNonGame.addEventListener('change', () => {
  const currentAll = visibleSteps[cursor] ?? 0;
  rebuildVisible();
  renderEventList();
  let next = 0;
  for (let i = visibleSteps.length - 1; i >= 0; i--) {
    if (visibleSteps[i] <= currentAll) { next = i; break; }
  }
  moveCursor(next);
});

document.addEventListener('keydown', (e) => {
  if (screenViewer.hidden) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.key === 'ArrowRight') { moveCursor(cursor + 1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft')  { moveCursor(cursor - 1); e.preventDefault(); }
  else if (e.key === 'Home') { moveCursor(0); e.preventDefault(); }
  else if (e.key === 'End')  { moveCursor(visibleSteps.length - 1); e.preventDefault(); }
  else if (e.key === 'Escape') { showList(); e.preventDefault(); }
});

document.querySelectorAll('#logFilters .log-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    listFilter = btn.dataset.mode;
    for (const b of document.querySelectorAll('#logFilters .log-filter-btn')) {
      b.classList.toggle('active', b.dataset.mode === listFilter);
    }
    renderList();
  });
});

loadList();

// ─── List screen ───────────────────────────────────────────────────────────
async function loadList() {
  logListEl.textContent = 'Загрузка…';
  try {
    const a = await fetch('/api/sync');
    const r = await fetch('/api/sessions');
    const j = await r.json();
    allSessions = j.sessions || [];
  } catch (err) {
    logListEl.innerHTML = `<div class="log-list-empty">Не удалось получить список: ${escapeHtml(String(err))}</div>`;
    return;
  }
  const counts = { all: allSessions.length, pvp: 0, solo: 0 };
  for (const s of allSessions) {
    if (s.mode === 'pvp')  counts.pvp++;
    else if (s.mode === 'solo') counts.solo++;
  }
  document.querySelectorAll('#logFilters .log-filter-count').forEach((el) => {
    el.textContent = ` (${counts[el.dataset.count] ?? 0})`;
  });
  renderList();
}

function renderList() {
  if (allSessions.length === 0) {
    logListEl.innerHTML = `<div class="log-list-empty">Партий пока нет. Backend пишет в <code>logs/&lt;mode&gt;/&lt;session&gt;/</code> — положи такую директорию в <code>log-viewer/logs/</code>.</div>`;
    return;
  }
  const filtered = allSessions.filter((s) => listFilter === 'all' || s.mode === listFilter);
  if (filtered.length === 0) {
    logListEl.innerHTML = `<div class="log-list-empty">Нет партий с фильтром <b>${escapeHtml(listFilter)}</b>.</div>`;
    return;
  }

  // Group: month → day → [sessions].
  const monthMap = new Map();
  for (const s of filtered) {
    const ts = s.startedAt ? Date.parse(s.startedAt) : 0;
    const d = new Date(ts || Date.now());
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const dayKey   = `${monthKey}-${String(d.getDate()).padStart(2, '0')}`;
    let dayMap = monthMap.get(monthKey);
    if (!dayMap) { dayMap = new Map(); monthMap.set(monthKey, dayMap); }
    let arr = dayMap.get(dayKey);
    if (!arr) { arr = []; dayMap.set(dayKey, arr); }
    arr.push(s);
  }

  logListEl.innerHTML = '';
  for (const [monthKey, dayMap] of monthMap) {
    const monthEl = document.createElement('div');
    monthEl.className = 'log-month';
    const monthDate = new Date(`${monthKey}-01T00:00:00`);
    const monthTitle = document.createElement('div');
    monthTitle.className = 'log-month-title';
    monthTitle.textContent = monthDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
    monthEl.appendChild(monthTitle);

    for (const [dayKey, sessions] of dayMap) {
      const dayEl = document.createElement('div');
      dayEl.className = 'log-day';
      const dayDate = new Date(`${dayKey}T00:00:00`);
      const dayTitle = document.createElement('div');
      dayTitle.className = 'log-day-title';
      dayTitle.innerHTML = `
        <span>${escapeHtml(dayDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }))}</span>
        <span class="log-day-weekday">${escapeHtml(dayDate.toLocaleDateString(undefined, { weekday: 'long' }))}</span>
        <span class="log-day-weekday">· ${sessions.length} ${plural(sessions.length, 'партия', 'партии', 'партий')}</span>
      `;
      dayEl.appendChild(dayTitle);
      for (const s of sessions) dayEl.appendChild(renderSessionRow(s));
      monthEl.appendChild(dayEl);
    }
    logListEl.appendChild(monthEl);
  }
}

function renderSessionRow(session) {
  const el = document.createElement('div');
  el.className = `log-row ${escapeHtml(session.mode || 'unknown')}`;
  const ts = session.startedAt ? new Date(session.startedAt) : null;
  const time = ts
    ? `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
    : '—';
  const modeLabel = session.mode === 'solo' ? 'Соло'
                  : session.mode === 'pvp'  ? 'PvP'
                  : '—';

  const playersEl = document.createElement('div');
  playersEl.className = 'log-row-players';
  const red  = session.players?.red?.name  || null;
  const blue = session.players?.blue?.name || null;
  const winColor = session.result?.winner || null;
  const playerSpan = (name, color) => {
    const sp = document.createElement('span');
    sp.className = `log-row-player ${color}` + (winColor === color ? ' winner' : '');
    sp.textContent = name || (color === 'red' ? '?' : '?');
    return sp;
  };
  playersEl.appendChild(playerSpan(red, 'red'));
  const vs = document.createElement('span');
  vs.className = 'log-row-vs';
  vs.textContent = session.mode === 'solo' ? 'vs' : '×';
  playersEl.appendChild(vs);
  playersEl.appendChild(playerSpan(blue, 'blue'));

  const metaEl = document.createElement('div');
  metaEl.className = 'log-row-meta';
  const winText = session.result
    ? (session.result.winner
        ? `🏁 ${escapeHtml(session.result.winner)}${session.result.reason ? ` (${escapeHtml(session.result.reason)})` : ''}`
        : `🏳 ничья${session.result.reason ? ` (${escapeHtml(session.result.reason)})` : ''}`)
    : 'не закончена';
  const dur = session.durationMs ? `<span class="pill">${formatDuration(session.durationMs)}</span>` : '';
  const turns = session.totals?.turnsPlayed ? `<span class="pill">${session.totals.turnsPlayed} ходов</span>` : '';
  metaEl.innerHTML = `${winText}${dur}${turns}`;

  const timeEl = document.createElement('div');
  timeEl.className = 'log-row-time';
  timeEl.textContent = time;

  const modeEl = document.createElement('div');
  modeEl.className = 'log-row-mode';
  modeEl.textContent = modeLabel;

  el.appendChild(timeEl);
  el.appendChild(modeEl);
  el.appendChild(playersEl);
  el.appendChild(metaEl);
  el.addEventListener('click', () => openSession(session));
  return el;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function showList() {
  screenList.hidden = false;
  screenViewer.hidden = true;
  btnBack.hidden = true;
  currentSession = null;
  allSnapshots = [];
  visibleSteps = [];
}

// ─── Viewer ────────────────────────────────────────────────────────────────
async function openSession(session) {
  currentSession = session;
  viewerTitle.textContent = sessionTitle(session);
  viewerSubtitle.textContent = 'Загрузка…';
  screenList.hidden = true;
  screenViewer.hidden = false;
  btnBack.hidden = false;
  boardEl.innerHTML = '';
  statePanel.innerHTML = '';
  eventPanel.innerHTML = '';
  eventList.innerHTML = '';
  stepLabel.textContent = '0 / 0';

  let payload;
  try {
    const r = await fetch(`/api/session/${encodeURIComponent(session.id)}`);
    payload = await r.json();
  } catch (err) {
    viewerSubtitle.textContent = 'Ошибка загрузки: ' + err;
    return;
  }
  if (payload.error) {
    viewerSubtitle.textContent = 'Ошибка: ' + payload.error;
    return;
  }
  const meta = payload.meta || {};
  const events = payload.events || [];
  allSnapshots = buildSnapshots(meta, events);
  viewerSubtitle.textContent = sessionSubtitle(meta, events.length, allSnapshots.length - 1);
  rebuildVisible();
  renderEventList();
  moveCursor(0);
}

function sessionTitle(s) {
  const red  = s.players?.red?.name  || '?';
  const blue = s.players?.blue?.name || '?';
  const mode = s.mode === 'solo' ? '🤖' : '🪖';
  return `${mode} ${red} vs ${blue}`;
}

function sessionSubtitle(meta, evCount, stepCount) {
  const ts = meta.startedAtLocal || meta.startedAt || '—';
  const result = meta.result
    ? (meta.result.winner
        ? `победитель ${meta.result.winner} (${meta.result.reason})`
        : `ничья (${meta.result.reason})`)
    : 'не завершена';
  const dur = meta.durationMs ? `, длилась ${formatDuration(meta.durationMs)}` : '';
  return `${ts} · ${result}${dur} · ${evCount} событий · ${stepCount} ходов`;
}

// ─── Replay engine ─────────────────────────────────────────────────────────
function buildSnapshots(meta, events) {
  const initial = createInitialState(meta);
  const snaps = [{ state: cloneState(initial), event: null, index: -1 }];
  let cur = cloneState(initial);
  events.forEach((ev, i) => {
    applyEvent(cur, ev);
    snaps.push({ state: cloneState(cur), event: ev, index: i });
  });
  return snaps;
}

function createInitialState(meta) {
  const config = { ...DEFAULT_CONFIG, ...(meta.config || {}) };
  const size = config.boardSize;
  const board = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      row.push({
        owner: r < size / 2 ? 'red' : 'blue',
        hasMine: false,
      });
    }
    board.push(row);
  }
  const players = {
    red:  { name: meta.players?.red?.name  || 'red',  color: 'red',  lives: config.maxLives, minesPlaced: 0 },
    blue: { name: meta.players?.blue?.name || 'blue', color: 'blue', lives: config.maxLives, minesPlaced: 0 },
  };
  return {
    config,
    board,
    players,
    phase: 'setup',
    currentPlayer: 'red',
    displayZone: null,
    actionZone:  null,
    capturedThisTurn: [],
    lastEventCells: [],
    finished: false,
    winner: null,
    winReason: null,
    turnsPlayed: 0,
    defusesUsedThisTurn: 0,
    timeLeftMs: { red: null, blue: null },
  };
}

function cloneState(s) {
  return {
    config: s.config,
    board: s.board.map((row) => row.map((cell) => ({ ...cell }))),
    players: { red: { ...s.players.red }, blue: { ...s.players.blue } },
    phase: s.phase,
    currentPlayer: s.currentPlayer,
    displayZone: s.displayZone ? { ...s.displayZone } : null,
    actionZone:  s.actionZone  ? { ...s.actionZone  } : null,
    capturedThisTurn: [...s.capturedThisTurn],
    lastEventCells: [...s.lastEventCells],
    finished: s.finished,
    winner: s.winner,
    winReason: s.winReason,
    turnsPlayed: s.turnsPlayed,
    defusesUsedThisTurn: s.defusesUsedThisTurn,
    timeLeftMs: { ...s.timeLeftMs },
  };
}

function applyEvent(s, ev) {
  s.lastEventCells = [];
  const actor = ev.actor;
  if (typeof ev.timeLeftMs === 'number' && actor) {
    s.timeLeftMs[actor] = ev.timeLeftMs;
  }

  switch (ev.kind) {
    case 'setup_mine': {
      const c = s.board[ev.row]?.[ev.col];
      if (!c) break;
      c.hasMine = !!ev.hasMine;
      if (actor && typeof ev.minesPlaced === 'number') {
        s.players[actor].minesPlaced = ev.minesPlaced;
      }
      s.phase = 'setup';
      s.lastEventCells.push({ row: ev.row, col: ev.col });
      break;
    }

    case 'setup_confirmed':
      s.phase = 'setup';
      break;

    case 'game_started':
      s.phase = 'phase1';
      s.currentPlayer = actor || 'red';
      break;

    case 'zone_select': {
      if (ev.displayZone) s.displayZone = { ...ev.displayZone };
      if (ev.actionZone)  s.actionZone  = { ...ev.actionZone };
      s.phase = 'phase2';
      if (actor) s.currentPlayer = actor;
      s.capturedThisTurn = [];
      s.defusesUsedThisTurn = 0;
      const dz = s.displayZone;
      if (dz) {
        for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
          s.lastEventCells.push({ row: dz.row + dr, col: dz.col + dc });
        }
      }
      break;
    }

    case 'cell_open': {
      const c = s.board[ev.row]?.[ev.col];
      if (c && actor) c.owner = actor;
      if (actor) s.currentPlayer = actor;
      s.capturedThisTurn.push({ row: ev.row, col: ev.col });
      s.lastEventCells.push({ row: ev.row, col: ev.col });
      break;
    }

    case 'mine_hit': {
      const c = s.board[ev.row]?.[ev.col];
      if (c) c.hasMine = false;
      if (actor) {
        if (typeof ev.livesLeft === 'number') s.players[actor].lives = ev.livesLeft;
        else s.players[actor].lives = Math.max(0, s.players[actor].lives - 1);
        s.currentPlayer = actor;
      }
      s.lastEventCells.push({ row: ev.row, col: ev.col });
      break;
    }

    case 'mine_defused': {
      const c = s.board[ev.row]?.[ev.col];
      if (c) {
        if (ev.hadMine) c.hasMine = false;
        if (actor) c.owner = actor;
      }
      if (actor) s.currentPlayer = actor;
      s.defusesUsedThisTurn++;
      s.capturedThisTurn.push({ row: ev.row, col: ev.col });
      s.lastEventCells.push({ row: ev.row, col: ev.col });
      break;
    }

    case 'phase3_mine': {
      const c = s.board[ev.row]?.[ev.col];
      if (c) c.hasMine = true;
      if (actor) s.players[actor].minesPlaced++;
      s.phase = 'phase3';
      s.lastEventCells.push({ row: ev.row, col: ev.col });
      break;
    }

    case 'turn_end':
      // Завершение хода: переход к сопернику, очистка визуальных зон.
      s.phase = 'phase1';
      s.currentPlayer = (actor || s.currentPlayer) === 'red' ? 'blue' : 'red';
      s.displayZone = null;
      s.actionZone = null;
      s.capturedThisTurn = [];
      s.defusesUsedThisTurn = 0;
      if (typeof ev.turnsPlayed === 'number') s.turnsPlayed = ev.turnsPlayed;
      else s.turnsPlayed++;
      break;

    case 'game_finished':
      s.finished = true;
      s.winner = ev.winner || null;
      s.winReason = ev.reason || null;
      break;

    default:
      // Неизвестное событие — игнор.
      break;
  }
}

// Цифры на поле умышленно не отображаются: в просмотрщике мы и так видим
// расположение всех мин обоих игроков, число «сколько мин соперника рядом»
// никакой дополнительной информации не несёт.

// ─── Visible-steps filter ──────────────────────────────────────────────────
function rebuildVisible() {
  const skipNonGame = chkSkipNonGame.checked;
  visibleSteps = [];
  visibleSteps.push(0);
  for (let i = 1; i < allSnapshots.length; i++) {
    const ev = allSnapshots[i].event;
    if (!ev) continue;
    if (skipNonGame && !GAME_EVENT_KINDS.has(ev.kind)) continue;
    visibleSteps.push(i);
  }
}

function moveCursor(idx) {
  if (visibleSteps.length === 0) return;
  cursor = Math.max(0, Math.min(visibleSteps.length - 1, idx));
  renderCurrent();
  updateEventListSelection();
}

// ─── Render ────────────────────────────────────────────────────────────────
function renderCurrent() {
  const snap = allSnapshots[visibleSteps[cursor]];
  if (!snap) return;
  const s = snap.state;
  const size = s.config.boardSize;

  boardEl.style.gridTemplateColumns = `repeat(${size}, auto)`;
  boardEl.innerHTML = '';
  const dz = s.displayZone;
  const az = s.actionZone;
  const recentSet = new Set(s.lastEventCells.map((p) => `${p.row},${p.col}`));
  const hqFirstCol = Math.floor((size - 2) / 2);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = s.board[r][c];
      const div = document.createElement('div');
      div.className = 'cell';
      if (cell.owner === 'red')  div.classList.add('red');
      if (cell.owner === 'blue') div.classList.add('blue');
      const isHq =
        (r === 0 || r === size - 1) && (c === hqFirstCol || c === hqFirstCol + 1);
      if (isHq) div.classList.add('hq');
      const inDisplay = dz && r >= dz.row && r < dz.row + 3 && c >= dz.col && c < dz.col + 3;
      const inAction  = az && r >= az.row && r < az.row + 5 && c >= az.col && c < az.col + 5;
      if (inDisplay) div.classList.add('in-display');
      if (inAction)  div.classList.add('in-action');
      if (recentSet.has(`${r},${c}`)) div.classList.add('recent');

      if (cell.hasMine) {
        const m = document.createElement('span');
        m.className = 'mine ' + (cell.owner || '');
        m.textContent = '💣';
        div.appendChild(m);
      }
      boardEl.appendChild(div);
    }
  }

  boardLegend.innerHTML = `
    <span><span class="legend-swatch" style="background:var(--red-soft)"></span>red</span>
    <span><span class="legend-swatch" style="background:var(--blue-soft)"></span>blue</span>
    <span><span class="legend-swatch" style="background:transparent;border-color:var(--highlight)"></span>HQ / display 3×3</span>
    <span><span class="legend-swatch" style="background:transparent;border-color:var(--accent)"></span>action 5×5</span>
    <span>💣 — мина (своя для цвета клетки)</span>
  `;

  const pRed = s.players.red, pBlue = s.players.blue;
  const tRed  = s.timeLeftMs.red  != null ? formatDuration(s.timeLeftMs.red)  : '—';
  const tBlue = s.timeLeftMs.blue != null ? formatDuration(s.timeLeftMs.blue) : '—';
  statePanel.innerHTML = `
    <div class="player-bar red ${s.currentPlayer === 'red' ? 'active' : ''}">
      <div class="player-bar-name">🔴 ${escapeHtml(pRed.name)}</div>
      <div class="player-bar-stats">♥ ${pRed.lives} · 💣 ${pRed.minesPlaced} · ⏱ ${tRed}</div>
    </div>
    <div class="player-bar blue ${s.currentPlayer === 'blue' ? 'active' : ''}">
      <div class="player-bar-name">🔵 ${escapeHtml(pBlue.name)}</div>
      <div class="player-bar-stats">♥ ${pBlue.lives} · 💣 ${pBlue.minesPlaced} · ⏱ ${tBlue}</div>
    </div>
    <div class="lbl">Фаза</div><div class="val">${escapeHtml(s.phase)}</div>
    <div class="lbl">Ход</div><div class="val">${escapeHtml(s.currentPlayer)}</div>
    <div class="lbl">Ходов сыграно</div><div class="val">${s.turnsPlayed}</div>
    ${s.finished ? `
      <div class="lbl">Финиш</div>
      <div class="val">${escapeHtml(s.winner || 'ничья')} (${escapeHtml(s.winReason || '—')})</div>
    ` : ''}
  `;

  if (snap.event) {
    eventPanel.innerHTML = renderEventDetail(snap.event);
  } else {
    eventPanel.textContent = 'Начальное состояние';
  }

  stepLabel.textContent = `${cursor} / ${visibleSteps.length - 1}`;
  btnPrev.disabled  = cursor === 0;
  btnFirst.disabled = cursor === 0;
  btnNext.disabled  = cursor === visibleSteps.length - 1;
  btnLast.disabled  = cursor === visibleSteps.length - 1;
}

function renderEventList() {
  eventList.innerHTML = '';
  for (let v = 0; v < visibleSteps.length; v++) {
    const allIdx = visibleSteps[v];
    const snap = allSnapshots[allIdx];
    if (!snap.event) continue;
    const ev = snap.event;
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.cursor = String(v);
    const actor = ev.actor || '';
    const at = ev.row !== undefined && ev.col !== undefined ? ` (${ev.row},${ev.col})` : '';
    row.innerHTML = `<b>#${v}</b> ${escapeHtml(ev.kind)}${actor ? ` · <span class="event-actor ${escapeHtml(actor)}">${escapeHtml(actor)}</span>` : ''}${at}`;
    row.addEventListener('click', () => moveCursor(v));
    eventList.appendChild(row);
  }
}

function updateEventListSelection() {
  for (const row of eventList.children) {
    row.classList.toggle('current', Number(row.dataset.cursor) === cursor);
    if (row.classList.contains('current')) row.scrollIntoView({ block: 'nearest' });
  }
}

function renderEventDetail(ev) {
  const actor = ev.actor;
  const actorHtml = actor ? `<span class="event-actor ${escapeHtml(actor)}">${escapeHtml(actor)}</span>` : '';
  const parts = [];
  parts.push(`<span class="event-kind">${escapeHtml(ev.kind)}</span>${actor ? ' · ' + actorHtml : ''}`);
  const fields = {
    row: ev.row, col: ev.col,
    hasMine: ev.hasMine, hadMine: ev.hadMine,
    livesLeft: ev.livesLeft, minesPlaced: ev.minesPlaced,
    viaChord: ev.viaChord, viaDefuse: ev.viaDefuse,
    timeLeftMs: typeof ev.timeLeftMs === 'number' ? formatDuration(ev.timeLeftMs) : undefined,
    turnsPlayed: ev.turnsPlayed,
    reason: ev.reason, winner: ev.winner,
  };
  const kv = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    kv.push(`${k}: <b>${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))}</b>`);
  }
  if (ev.displayZone) kv.push(`displayZone: (${ev.displayZone.row}, ${ev.displayZone.col})`);
  if (ev.actionZone)  kv.push(`actionZone: (${ev.actionZone.row}, ${ev.actionZone.col})`);
  if (ev.clicked)     kv.push(`clicked: (${ev.clicked.row}, ${ev.clicked.col})`);
  if (kv.length) parts.push('<br>' + kv.join(' · '));
  if (ev.tsLocal || ev.ts) parts.push(`<br><span style="opacity:.6">ts: ${escapeHtml(ev.tsLocal || ev.ts)}${typeof ev.t === 'number' ? ` (+${formatDuration(ev.t)})` : ''}</span>`);
  return parts.join('');
}

// ─── Utilities ─────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (s) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}
function formatDuration(ms) {
  if (ms == null) return '—';
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
  return `${s}s`;
}
