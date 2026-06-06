/**
 * Vanilla-JS local log viewer.
 *
 * Architecture:
 *   - On load: fetches /api/logs and renders the list screen.
 *   - Opening a log: fetches its content, parses jsonl line-by-line,
 *     NORMALIZES events into a flat shape (so PvP server logs and
 *     local solo logs go through the same replay engine), and builds
 *     a per-event snapshot list.
 *   - Step controls (← / →, Home / End) move a cursor over the snapshots
 *     — navigation is O(1).
 *   - The board is rendered FULLY OPEN: mines of both colours and cell
 *     ownership are always shown. Numbers are shown ONLY inside the
 *     currently-active display zone (3×3) — matching the in-game UX.
 *   - A "Только игровые ходы" toggle filters out events that don't
 *     change the visible board (connect/disconnect, room_created,
 *     session_restored, defuses_granted, etc.).
 */

// ─── Defaults (mirrored from packages/shared/src/balance.config.json) ──────
const DEFAULT_CONFIG = {
  boardSize: 10,
  initialMinesRed: 7,
  initialMinesBlue: 9,
  maxLives: 3,
};

// Event kinds we consider "game-changing" for the skip-non-game filter.
// Everything else (room_created, player_joined, session_restored, …) is
// hidden when the toggle is on.
const GAME_EVENT_KINDS = new Set([
  'setup_mine_toggled',
  'setup_confirmed',
  'game_started',
  'solo_started',
  'zone_selected',
  'capture',
  'cell_captured',
  'mine_exploded',
  'defuse',
  'cell_defused',
  'defuse_success',
  'defuse_no_mine',
  'chord_started',
  'chord_finished',
  'mark_toggled',
  'end_phase2',
  'phase2_ended',
  'place_mine_phase3',
  'mine_placed_phase3',
  'phase3_mine_placed',
  'end_phase3',
  'phase3_ended',
  'game_finished',
  'solo_finished',
  'time_out',
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
let allSnapshots = [];   // every snapshot (incl. non-game ones)
let visibleSteps = [];   // indices into allSnapshots that are currently shown
let cursor       = 0;    // index into visibleSteps
let currentLog   = null;

// ─── Bootstrap ─────────────────────────────────────────────────────────────
btnRefresh.addEventListener('click', loadList);
btnBack.addEventListener('click', showList);
btnFirst.addEventListener('click', () => moveCursor(0));
btnPrev.addEventListener('click',  () => moveCursor(cursor - 1));
btnNext.addEventListener('click',  () => moveCursor(cursor + 1));
btnLast.addEventListener('click',  () => moveCursor(visibleSteps.length - 1));
chkSkipNonGame.addEventListener('change', () => {
  // Preserve the current snapshot when toggling.
  const currentAll = visibleSteps[cursor] ?? 0;
  rebuildVisible();
  // Find the closest visible step ≤ currentAll, else first.
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

loadList();

// ─── List screen ───────────────────────────────────────────────────────────
async function loadList() {
  logListEl.textContent = 'Загрузка…';
  let logs = [];
  try {
    const r = await fetch('/api/logs');
    const j = await r.json();
    logs = j.logs || [];
  } catch (err) {
    logListEl.innerHTML = `<div class="log-list-empty">Не удалось получить список: ${escapeHtml(String(err))}</div>`;
    return;
  }
  if (logs.length === 0) {
    logListEl.innerHTML = `<div class="log-list-empty">Логов пока нет. Положи <code>*.jsonl</code> файлы в <code>log-viewer/logs/</code>.</div>`;
    return;
  }
  logListEl.innerHTML = '';
  for (const log of logs) {
    const el = document.createElement('div');
    el.className = 'log-item';
    el.innerHTML = `
      <div class="log-item-label">${escapeHtml(log.label)}</div>
      <div class="log-item-meta">
        ${formatBytes(log.size)} · ${formatDate(log.mtime)}
      </div>
    `;
    el.addEventListener('click', () => openLog(log));
    logListEl.appendChild(el);
  }
}

function showList() {
  screenList.hidden = false;
  screenViewer.hidden = true;
  btnBack.hidden = true;
  currentLog = null;
  allSnapshots = [];
  visibleSteps = [];
}

// ─── Viewer ────────────────────────────────────────────────────────────────
async function openLog(log) {
  currentLog = log;
  viewerTitle.textContent = log.label;
  viewerSubtitle.textContent = 'Загрузка…';
  screenList.hidden = true;
  screenViewer.hidden = false;
  btnBack.hidden = false;
  boardEl.innerHTML = '';
  statePanel.innerHTML = '';
  eventPanel.innerHTML = '';
  eventList.innerHTML = '';
  stepLabel.textContent = '0 / 0';

  let text;
  try {
    const r = await fetch(`/api/log/${encodeURIComponent(log.id)}`);
    text = await r.text();
  } catch (err) {
    viewerSubtitle.textContent = 'Ошибка загрузки: ' + err;
    return;
  }
  const events = parseLog(text);
  allSnapshots = buildSnapshots(events);
  viewerSubtitle.textContent = `${events.length} событий · ${allSnapshots.length - 1} ходов`;
  rebuildVisible();
  renderEventList();
  moveCursor(0);
}

// ─── Parse jsonl ─ normalization ───────────────────────────────────────────
//
// Two log shapes exist:
//
// 1) PvP server log: flat fields
//      { event: "cell_captured", player: { color, name, ip }, row, col, ... }
//
// 2) Solo / local log: nested
//      { event: { kind: "capture", row, col, actor }, playerName, humanColor,
//        difficulty, currentPlayer, phase, ... }
//
// We normalize both into:
//      { kind, row?, col?, actor?, ts, raw, ...extra }
// where `actor` is the color whose move it is and `raw` keeps the original
// envelope for the side panel.
function parseLog(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try { parsed = JSON.parse(trimmed); }
    catch (_) { continue; }
    if (!parsed || typeof parsed !== 'object') continue;
    out.push(normalize(parsed));
  }
  return out;
}

function normalize(raw) {
  const ts = raw.ts || raw.timestamp || null;
  // Case 1: nested event object (solo).
  if (raw.event && typeof raw.event === 'object') {
    const e = raw.event;
    return {
      kind: e.kind || 'unknown',
      ts,
      row: e.row,
      col: e.col,
      actor: e.actor || raw.currentPlayer || null,
      mark: e.mark,
      // Pull useful side-info from the envelope.
      currentPlayer: raw.currentPlayer || null,
      phase: raw.phase || null,
      turnsPlayed: raw.turnsPlayed,
      humanColor: raw.humanColor,
      botColor: raw.botColor,
      playerName: raw.playerName,
      difficulty: raw.difficulty,
      raw,
    };
  }
  // Case 2: flat event string (PvP server).
  if (typeof raw.event === 'string') {
    return {
      kind: raw.event,
      ts,
      row: raw.row,
      col: raw.col,
      actor: raw.player?.color || raw.creator?.color || null,
      mark: raw.mark,
      player: raw.player,
      creator: raw.creator,
      players: raw.players,
      displayZone: raw.displayZone,
      actionZone:  raw.actionZone,
      clicked: raw.clicked,
      winner: raw.winner,
      reason: raw.reason || raw.winReason,
      hasMine: raw.hasMine,
      hadMine: raw.hadMine,
      livesLeft: raw.livesLeft,
      minesPlaced: raw.minesPlaced,
      defusesUsedThisTurn: raw.defusesUsedThisTurn,
      defusesPerTurn: raw.defusesPerTurn,
      viaChord: raw.viaChord,
      number: raw.number,
      flagCount: raw.flagCount,
      candidatesCount: raw.candidatesCount,
      captureCount: raw.captureCount,
      hitMine: raw.hitMine,
      raw,
    };
  }
  return { kind: 'unknown', ts, raw };
}

// ─── Replay engine ─────────────────────────────────────────────────────────
function buildSnapshots(events) {
  const config = extractConfig(events);
  const initial = createInitialState(config, events);
  const snaps = [{ state: cloneState(initial), event: null, index: -1 }];
  let cur = cloneState(initial);
  events.forEach((ev, i) => {
    applyEvent(cur, ev);
    snaps.push({ state: cloneState(cur), event: ev, index: i });
  });
  return snaps;
}

function extractConfig(events) {
  const cfg = { ...DEFAULT_CONFIG };
  for (const ev of events) {
    const r = ev.raw || {};
    const c = r.config || r.gameConfig;
    if (c && typeof c === 'object') Object.assign(cfg, c);
    if (r.boardSize)  cfg.boardSize = r.boardSize;
    if (r.maxLives)   cfg.maxLives  = r.maxLives;
  }
  return cfg;
}

function createInitialState(config, events) {
  const size = config.boardSize;
  // Owner: top half = red, bottom half = blue.
  const board = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      row.push({
        owner: r < size / 2 ? 'red' : 'blue',
        hasMine: false,
        mark: { red: 'none', blue: 'none' },
      });
    }
    board.push(row);
  }

  // Collect player names. For PvP logs the `players` field lists both; for
  // solo logs we have `playerName` + `humanColor` for the human and the bot
  // color is the opposite.
  const players = {};
  for (const ev of events) {
    const r = ev.raw || {};
    if (Array.isArray(r.players)) {
      for (const p of r.players) {
        if (p?.color && !players[p.color]) players[p.color] = { name: p.name || p.color, color: p.color };
      }
    }
    if (r.player?.color && !players[r.player.color]) {
      players[r.player.color] = { name: r.player.name || r.player.color, color: r.player.color };
    }
    if (r.creator?.color && !players[r.creator.color]) {
      players[r.creator.color] = { name: r.creator.name || r.creator.color, color: r.creator.color };
    }
    if (r.playerName && r.humanColor && !players[r.humanColor]) {
      players[r.humanColor] = { name: r.playerName, color: r.humanColor };
    }
    if (r.humanColor) {
      const bot = r.humanColor === 'red' ? 'blue' : 'red';
      if (!players[bot]) {
        const botName = r.difficulty ? `Бот (${r.difficulty})` : 'Бот';
        players[bot] = { name: botName, color: bot };
      }
    }
    if (players.red && players.blue) break;
  }
  if (!players.red)  players.red  = { name: 'red',  color: 'red' };
  if (!players.blue) players.blue = { name: 'blue', color: 'blue' };

  return {
    config,
    board,
    players: {
      red:  { ...players.red,  lives: config.maxLives, minesPlaced: 0 },
      blue: { ...players.blue, lives: config.maxLives, minesPlaced: 0 },
    },
    phase: 'waiting',
    currentPlayer: 'red',
    displayZone: null,
    actionZone:  null,
    capturedThisTurn: [],
    lastEventCells: [],
    finished: false,
    winner: null,
    winReason: null,
    turnsPlayed: 0,
    defusesPerTurn: 1,
    defusesUsedThisTurn: 0,
  };
}

function cloneState(s) {
  return {
    config: s.config,
    board: s.board.map((row) => row.map((cell) => ({
      ...cell,
      mark: { ...cell.mark },
    }))),
    players: {
      red:  { ...s.players.red },
      blue: { ...s.players.blue },
    },
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
    defusesPerTurn: s.defusesPerTurn,
    defusesUsedThisTurn: s.defusesUsedThisTurn,
  };
}

// Apply one normalized event to mutable state.
function applyEvent(s, ev) {
  s.lastEventCells = [];
  const size = s.config.boardSize;
  // Pre-compute display/action zones derived from a click in solo logs.
  // Solo's zone_selected carries `row,col` (the click), not the top-left.
  const derivedDisplayFromClick = (row, col) => ({ row: row - 1, col: col - 1 });
  const derivedActionFromClick  = (row, col) => ({ row: row - 2, col: col - 2 });
  // Propagate phase/currentPlayer/turnsPlayed when the log envelope provides
  // them — this is the cheapest way to keep solo logs in sync.
  if (ev.raw) {
    if (ev.raw.phase) s.phase = ev.raw.phase;
    if (ev.raw.currentPlayer) s.currentPlayer = ev.raw.currentPlayer;
    if (typeof ev.raw.turnsPlayed === 'number') s.turnsPlayed = ev.raw.turnsPlayed;
  }

  switch (ev.kind) {
    case 'room_created':
    case 'player_joined':
    case 'session_restored':
    case 'player_left':
    case 'player_disconnected':
    case 'room_deleted':
    case 'solo_started':
      break;

    case 'setup_mine_toggled': {
      const c = s.board[ev.row]?.[ev.col];
      if (!c) break;
      // PvP log carries explicit `hasMine`; solo log just toggles.
      if (typeof ev.hasMine === 'boolean') {
        c.hasMine = ev.hasMine;
      } else {
        c.hasMine = !c.hasMine;
      }
      if (ev.actor) {
        s.players[ev.actor].minesPlaced += c.hasMine ? 1 : -1;
        if (typeof ev.minesPlaced === 'number') {
          s.players[ev.actor].minesPlaced = ev.minesPlaced;
        }
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
      s.currentPlayer = ev.actor || ev.raw?.firstPlayer || 'red';
      // Clear any setup-phase mark visualization.
      break;

    case 'zone_selected': {
      const click = (ev.row !== undefined && ev.col !== undefined)
        ? { row: ev.row, col: ev.col } : null;
      if (ev.displayZone)  s.displayZone = { row: ev.displayZone.row, col: ev.displayZone.col };
      else if (click)      s.displayZone = derivedDisplayFromClick(click.row, click.col);
      if (ev.actionZone)   s.actionZone  = { row: ev.actionZone.row,  col: ev.actionZone.col  };
      else if (click)      s.actionZone  = derivedActionFromClick(click.row, click.col);
      s.phase = 'phase2';
      if (ev.actor) s.currentPlayer = ev.actor;
      s.capturedThisTurn = [];
      s.defusesUsedThisTurn = 0;
      // Highlight the display 3×3 cells.
      const dz = s.displayZone;
      if (dz) {
        for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
          s.lastEventCells.push({ row: dz.row + dr, col: dz.col + dc });
        }
      }
      break;
    }

    case 'capture':
    case 'cell_captured': {
      const color = ev.actor;
      const c = s.board[ev.row]?.[ev.col];
      if (c && color) {
        c.owner = color;
        c.mark.red = 'none';
        c.mark.blue = 'none';
      }
      if (color) s.currentPlayer = color;
      s.capturedThisTurn.push({ row: ev.row, col: ev.col });
      s.lastEventCells.push({ row: ev.row, col: ev.col });
      break;
    }

    case 'mine_exploded': {
      const color = ev.actor;
      const c = s.board[ev.row]?.[ev.col];
      if (c) c.hasMine = false;
      if (color && typeof ev.livesLeft === 'number') {
        s.players[color].lives = ev.livesLeft;
      } else if (color) {
        s.players[color].lives = Math.max(0, s.players[color].lives - 1);
      }
      if (color) s.currentPlayer = color;
      s.lastEventCells.push({ row: ev.row, col: ev.col });
      break;
    }

    case 'defuse':
    case 'cell_defused':
    case 'defuse_success':
    case 'defuse_no_mine': {
      const color = ev.actor;
      const c = s.board[ev.row]?.[ev.col];
      if (c && color) {
        // Per applyDefuse: cell becomes ours, mine (if any) removed.
        if (ev.hadMine || ev.kind === 'defuse_success' || (ev.kind === 'defuse' && c.hasMine)) {
          c.hasMine = false;
        }
        // For some solo logs `defuse` doesn't carry hadMine — be tolerant.
        if (ev.kind === 'defuse_no_mine') c.hasMine = false;
        c.owner = color;
        c.mark.red = 'none';
        c.mark.blue = 'none';
      }
      if (color) s.currentPlayer = color;
      if (typeof ev.defusesUsedThisTurn === 'number') s.defusesUsedThisTurn = ev.defusesUsedThisTurn;
      if (typeof ev.defusesPerTurn === 'number') s.defusesPerTurn = ev.defusesPerTurn;
      s.capturedThisTurn.push({ row: ev.row, col: ev.col });
      s.lastEventCells.push({ row: ev.row, col: ev.col });
      break;
    }

    case 'chord_started':
      if (ev.actor) s.currentPlayer = ev.actor;
      s.lastEventCells.push({ row: ev.row, col: ev.col });
      break;
    case 'chord_finished':
      if (ev.actor) s.currentPlayer = ev.actor;
      s.lastEventCells.push({ row: ev.row, col: ev.col });
      break;

    case 'defuses_granted':
      if (typeof ev.raw?.defusesPerTurn === 'number') s.defusesPerTurn = ev.raw.defusesPerTurn;
      break;

    case 'mark_toggled': {
      const color = ev.actor;
      const mark = ev.mark || 'flag';
      const c = s.board[ev.row]?.[ev.col];
      if (c && color) {
        // Solo logs typically don't include `mark`; assume toggle flag↔none.
        if (!ev.mark) {
          c.mark[color] = c.mark[color] === 'flag' ? 'none' : 'flag';
        } else {
          c.mark[color] = mark;
        }
      }
      s.lastEventCells.push({ row: ev.row, col: ev.col });
      break;
    }

    case 'end_phase2':
    case 'phase2_ended':
      s.phase = 'phase3';
      // Keep displayZone / actionZone visible — they're informational.
      s.capturedThisTurn = [];
      s.defusesUsedThisTurn = 0;
      break;

    case 'place_mine_phase3':
    case 'mine_placed_phase3':
    case 'phase3_mine_placed': {
      const c = s.board[ev.row]?.[ev.col];
      if (c) c.hasMine = true;
      const color = ev.actor;
      if (color && typeof ev.minesPlaced === 'number') {
        s.players[color].minesPlaced = ev.minesPlaced;
      } else if (color) {
        s.players[color].minesPlaced++;
      }
      s.phase = 'phase3';
      s.lastEventCells.push({ row: ev.row, col: ev.col });
      break;
    }

    case 'end_phase3':
    case 'phase3_ended':
      s.phase = 'phase1';
      s.currentPlayer = s.currentPlayer === 'red' ? 'blue' : 'red';
      s.turnsPlayed = (s.turnsPlayed ?? 0) + 1;
      s.displayZone = null;
      s.actionZone = null;
      s.capturedThisTurn = [];
      s.defusesUsedThisTurn = 0;
      break;

    case 'game_finished':
    case 'solo_finished':
      s.finished = true;
      s.winner = ev.winner?.color || ev.raw?.winner?.color || ev.raw?.winner || ev.winner || null;
      if (typeof s.winner === 'object') s.winner = s.winner.color;
      s.winReason = ev.reason || ev.raw?.reason || null;
      break;

    case 'time_out':
      s.finished = true;
      if (ev.actor) {
        s.winner = ev.actor === 'red' ? 'blue' : 'red';
        s.winReason = 'time';
      }
      break;

    default:
      // Unknown event: ignored.
      break;
  }
}

// ─── Numbers: ONLY inside currently-active display zone ────────────────────
function computeNumbersInDisplayZone(s) {
  // Returns a Map "r,c" → { value, owner } for cells whose owner had their
  // number revealed by sitting in the current display zone, mirroring the
  // backend's revealNumberForCell logic.
  const numbers = new Map();
  const dz = s.displayZone;
  if (!dz) return numbers;
  const size = s.config.boardSize;
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
    const r = dz.row + dr;
    const c = dz.col + dc;
    if (r < 0 || c < 0 || r >= size || c >= size) continue;
    const cell = s.board[r][c];
    if (!cell.owner) continue;
    let count = 0;
    for (let er = -1; er <= 1; er++) for (let ec = -1; ec <= 1; ec++) {
      if (er === 0 && ec === 0) continue;
      const nr = r + er, nc = c + ec;
      if (nr < 0 || nc < 0 || nr >= size || nc >= size) continue;
      const n = s.board[nr][nc];
      if (n.hasMine && n.owner !== cell.owner) count++;
    }
    numbers.set(`${r},${c}`, count);
  }
  return numbers;
}

// ─── Visible-steps filter (skip-non-game toggle) ───────────────────────────
function rebuildVisible() {
  const skipNonGame = chkSkipNonGame.checked;
  visibleSteps = [];
  // Step 0 (initial state) is always shown.
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
  const numbers = computeNumbersInDisplayZone(s);

  // Board ────────────────────────────────────────
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

      // Mine wins over number; numbers are only shown for cells in display zone.
      if (cell.hasMine) {
        const m = document.createElement('span');
        m.className = 'mine ' + (cell.owner || '');
        m.textContent = '💣';
        div.appendChild(m);
      } else if (inDisplay) {
        const k = `${r},${c}`;
        const n = numbers.get(k);
        if (n !== undefined && n > 0) {
          const ns = document.createElement('span');
          ns.className = 'number';
          ns.textContent = String(n);
          ns.style.color = numberColor(n);
          div.appendChild(ns);
        }
      }

      const redMark  = cell.mark.red;
      const blueMark = cell.mark.blue;
      const markChar = pickMarkChar(redMark, blueMark);
      if (markChar) {
        const mk = document.createElement('span');
        mk.className = 'mark';
        mk.textContent = markChar;
        div.appendChild(mk);
      }
      boardEl.appendChild(div);
    }
  }

  // Legend ────────────────────────────────────────
  boardLegend.innerHTML = `
    <span><span class="legend-swatch" style="background:var(--red-soft)"></span>red</span>
    <span><span class="legend-swatch" style="background:var(--blue-soft)"></span>blue</span>
    <span><span class="legend-swatch" style="background:transparent;border-color:var(--highlight)"></span>HQ / display 3×3</span>
    <span><span class="legend-swatch" style="background:transparent;border-color:var(--accent)"></span>action 5×5</span>
    <span>💣 — мина (своя для цвета клетки)</span>
    <span>Цифры — только внутри display 3×3</span>
  `;

  // State panel ─────────────────────────────────
  const pRed = s.players.red, pBlue = s.players.blue;
  statePanel.innerHTML = `
    <div class="player-bar red ${s.currentPlayer === 'red' ? 'active' : ''}">
      <div class="player-bar-name">🔴 ${escapeHtml(pRed.name)}</div>
      <div class="player-bar-stats">♥ ${pRed.lives} · 💣 ${pRed.minesPlaced}</div>
    </div>
    <div class="player-bar blue ${s.currentPlayer === 'blue' ? 'active' : ''}">
      <div class="player-bar-name">🔵 ${escapeHtml(pBlue.name)}</div>
      <div class="player-bar-stats">♥ ${pBlue.lives} · 💣 ${pBlue.minesPlaced}</div>
    </div>
    <div class="lbl">Фаза</div><div class="val">${escapeHtml(s.phase)}</div>
    <div class="lbl">Ход</div><div class="val">${escapeHtml(s.currentPlayer)}</div>
    <div class="lbl">Ходов сыграно</div><div class="val">${s.turnsPlayed}</div>
    <div class="lbl">Defuses (исп./всего)</div><div class="val">${s.defusesUsedThisTurn} / ${s.defusesPerTurn}</div>
    ${s.finished ? `
      <div class="lbl">Финиш</div>
      <div class="val">${escapeHtml(s.winner || '—')} (${escapeHtml(s.winReason || '—')})</div>
    ` : ''}
  `;

  // Event panel ──────────────────────────────────
  if (snap.event) {
    eventPanel.innerHTML = renderEventDetail(snap.event);
  } else {
    eventPanel.textContent = 'Начальное состояние';
  }

  // Step label ──────────────────────────────────
  stepLabel.textContent = `${cursor} / ${visibleSteps.length - 1}`;
  btnPrev.disabled  = cursor === 0;
  btnFirst.disabled = cursor === 0;
  btnNext.disabled  = cursor === visibleSteps.length - 1;
  btnLast.disabled  = cursor === visibleSteps.length - 1;
}

function renderEventList() {
  eventList.innerHTML = '';
  // Show only the events that match the current "visible" filter.
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
    row: ev.row, col: ev.col, mark: ev.mark,
    hasMine: ev.hasMine, hadMine: ev.hadMine,
    livesLeft: ev.livesLeft, minesPlaced: ev.minesPlaced,
    defusesUsed: ev.defusesUsedThisTurn, defusesPer: ev.defusesPerTurn,
    number: ev.number, flagCount: ev.flagCount,
    captureCount: ev.captureCount, hitMine: ev.hitMine,
    viaChord: ev.viaChord, reason: ev.reason, winner: ev.winner,
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
  if (ev.ts) parts.push(`<br><span style="opacity:.6">ts: ${escapeHtml(ev.ts)}</span>`);
  return parts.join('');
}

function numberColor(n) {
  switch (n) {
    case 1: return '#5aa9ff';
    case 2: return '#3ec78e';
    case 3: return '#ff7a6a';
    case 4: return '#9c6bff';
    case 5: return '#e29a5b';
    case 6: return '#5fd5d0';
    case 7: return '#dddddd';
    case 8: return '#888888';
    default: return '#ccc';
  }
}

function pickMarkChar(redMark, blueMark) {
  if (redMark === 'flag' || blueMark === 'flag') return '🚩';
  if (redMark === 'question' || blueMark === 'question') return '?';
  return null;
}

// ─── Utilities ─────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (s) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}
function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleString();
}
