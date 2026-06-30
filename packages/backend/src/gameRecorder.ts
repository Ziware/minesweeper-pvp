/**
 * Унифицированный recorder партий — единый источник правды для логирования
 * как PvP-игр (вызовы из roomManager), так и solo (вызовы из socket-хендлера
 * с фронтенда).
 *
 * Архитектура:
 *   - На каждую партию создаётся отдельная директория logs/<dir>/
 *     с двумя файлами:
 *       • meta.json       — полная информация о партии (mode, игроки, IP,
 *                            конфиг, время начала/конца, длительность,
 *                            итог); ОБНОВЛЯЕТСЯ непрерывно при каждом
 *                            значимом изменении.
 *       • game.log.jsonl  — append-only список «игровых» событий по
 *                            упрощённой схеме (см. GameEventKind ниже).
 *                            Эта схема ОДИНАКОВА для PvP и solo —
 *                            просмотрщик не различает их при реплее.
 *   - Все timestamp'ы дублируются: `ts` (ISO UTC, для машин), `tsLocal`
 *     ("YYYY-MM-DD HH:mm:ss" в часовом поясе сервера, для глаз). Также
 *     каждое событие несёт `t` — миллисекунды от старта партии.
 */

import fs from 'fs';
import path from 'path';
import type { GameConfig, PlayerColor } from '@minesweeper-pvp/shared';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://api:3002';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

async function reportGameToApi(meta: GameMeta, directory: string): Promise<void> {
  if (!INTERNAL_API_KEY) {
    console.warn('[gameRecorder] INTERNAL_API_KEY not set, skipping game report');
    return;
  }
  if (!meta.result || !meta.endedAt || meta.durationMs == null) return;

  // Compute relative logPath: strip LOG_ROOT prefix
  const relPath = path.relative(LOG_ROOT, directory);

  const colors: Array<'red' | 'blue'> = ['red', 'blue'];
  const participants = colors
    .map((color) => {
      const p = meta.players[color];
      if (!p) return null;
      const isWinner = meta.result!.winner === color;
      return {
        userId:   p.userId ?? null,
        color,
        name:     p.name,
        isBot:    p.isBot ?? false,
        isWinner,
      };
    })
    .filter(Boolean);

  if (participants.length === 0) return;

  const body = {
    sessionId:   meta.sessionId,
    mode:        meta.mode,
    isRated:     false,
    startedAt:   meta.startedAt,
    endedAt:     meta.endedAt,
    durationMs:  meta.durationMs,
    turnsPlayed: meta.totals.turnsPlayed,
    winnerColor: meta.result.winner ?? null,
    winReason:   meta.result.reason,
    logPath:     relPath,
    participants,
  };

  const resp = await fetch(`${INTERNAL_API_URL}/internal/games`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'X-Internal-Key': INTERNAL_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.warn(`[gameRecorder] API returned ${resp.status}:`, text);
  }
}

const LOG_ROOT = process.env.GAME_LOG_DIR || path.resolve(process.cwd(), 'logs');

// ─── Time helpers ──────────────────────────────────────────────────────────

export function formatLocalTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function safeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'unknown';
}

function dirSafeTimestamp(date: Date): string {
  // Безопасное имя директории: 2026-06-06_22-43-25
  return formatLocalTimestamp(date).replace(' ', '_').replace(/:/g, '-');
}

export function getClientIp(handshakeAddress?: string, forwardedFor?: string | string[]): string {
  const forwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const firstForwarded = forwarded?.split(',')[0]?.trim();
  return firstForwarded || handshakeAddress || 'unknown';
}

// ─── Schema ────────────────────────────────────────────────────────────────

export type GameMode = 'pvp' | 'solo';

export interface PlayerMeta {
  color: PlayerColor;
  name: string;
  ip?: string;
  /** Authenticated user id (UUID from the API). */
  userId?: string;
  /** Только для solo и только для бота. */
  difficulty?: string;
  /** true для бота в solo. */
  isBot?: boolean;
}

export interface GameResult {
  winner: PlayerColor | null;
  /** 'lives' | 'headquarters' | 'time' | 'draw' и т.п. */
  reason: string;
}

export interface GameMeta {
  sessionId: string;
  mode: GameMode;
  startedAt: string;
  startedAtLocal: string;
  endedAt?: string;
  endedAtLocal?: string;
  /** Длительность партии в мс (endedAt − startedAt). */
  durationMs?: number;
  config: GameConfig;
  players: { red?: PlayerMeta; blue?: PlayerMeta };
  result?: GameResult;
  /** Счётчики, обновляются recorder'ом по мере поступления событий. */
  totals: {
    turnsPlayed: number;
    moves: number;
  };
}

/**
 * Унифицированный набор «игровых» событий, которые рисует просмотрщик.
 *
 *   setup_mine        — расстановка стартовой мины (или её снятие при toggle).
 *   setup_confirmed   — игрок подтвердил расстановку.
 *   game_started      — обе расстановки подтверждены, фаза 1 началась.
 *   zone_select       — игрок выбрал зону 3×3 (центр в clicked).
 *   cell_open         — открытие клетки (захват). Один аккорд = N событий.
 *   mine_hit          — взрыв на мине (мина удаляется, жизнь -1).
 *   mine_defused      — разминирование (клетка переходит к игроку;
 *                       если там была мина — она удаляется).
 *   phase3_mine       — игрок поставил мину в фазе 3 (на свою клетку).
 *   turn_end          — конец фазы 3 → ход переходит сопернику.
 *   game_finished     — партия завершилась (winner/reason в payload).
 */
export type GameEventKind =
  | 'setup_mine'
  | 'setup_confirmed'
  | 'game_started'
  | 'zone_select'
  | 'cell_open'
  | 'mine_hit'
  | 'mine_defused'
  | 'phase3_mine'
  | 'turn_end'
  | 'game_finished';

export interface GameEvent {
  /** ISO UTC. */
  ts: string;
  /** Локальное «YYYY-MM-DD HH:mm:ss». */
  tsLocal: string;
  /** Миллисекунды от startedAt партии. */
  t: number;
  kind: GameEventKind;
  /** Цвет того, кто действует (если применимо). */
  actor?: PlayerColor;
  /** Координаты для cell-событий. */
  row?: number;
  col?: number;
  /** Произвольные доп-поля события. */
  [k: string]: unknown;
}

// ─── Recorder ──────────────────────────────────────────────────────────────

export interface GameRecorder {
  readonly sessionId: string;
  readonly directory: string;
  /** Полная актуальная meta (живая копия, не копируется при чтении). */
  readonly meta: GameMeta;

  setPlayer(player: PlayerMeta): void;
  /** Update userId for an already-registered player (call before gameFinished). */
  setPlayerUserId(color: PlayerColor, userId: string): void;
  setConfig(config: GameConfig): void;

  setupMine(color: PlayerColor, row: number, col: number, hasMine: boolean, minesPlaced: number): void;
  setupConfirmed(color: PlayerColor, minesPlaced: number): void;
  gameStarted(firstPlayer: PlayerColor): void;
  zoneSelect(color: PlayerColor, click: { row: number; col: number }, display: { row: number; col: number }, action: { row: number; col: number }, timeLeftMs?: number): void;
  cellOpen(color: PlayerColor, row: number, col: number, opts?: { viaChord?: boolean; viaDefuse?: boolean; timeLeftMs?: number }): void;
  mineHit(color: PlayerColor, row: number, col: number, livesLeft: number, opts?: { viaChord?: boolean; timeLeftMs?: number }): void;
  mineDefused(color: PlayerColor, row: number, col: number, hadMine: boolean, opts?: { timeLeftMs?: number }): void;
  phase3Mine(color: PlayerColor, row: number, col: number, opts?: { timeLeftMs?: number }): void;
  turnEnd(color: PlayerColor, opts?: { timeLeftMs?: number; turnsPlayed?: number }): void;
  gameFinished(winner: PlayerColor | null, reason: string): void;
  /** Записать вспомогательное событие (не игровое) в aux.log.jsonl рядом. */
  appendAux(auxKind: string, details?: Record<string, unknown>): void;
}

export interface CreateRecorderOpts {
  sessionId: string;
  mode: GameMode;
  initialPlayer?: PlayerMeta;
}

/**
 * Создаёт recorder для одной партии. Каталог имени:
 *   logs/<mode>/<red>-<blue>-<localTs>/
 *   logs/<mode>/<player>-waiting-<localTs>/  (пока второй не подключился)
 *   logs/<mode>/<player>-<bot>-<localTs>/    (для solo)
 */
export function createGameRecorder(opts: CreateRecorderOpts): GameRecorder {
  const startedAtDate = new Date();
  const sessionId = opts.sessionId;
  const mode = opts.mode;

  // Изначально каталог называется по тому, кого мы знаем; будем
  // переименовывать при подключении второго игрока.
  const labelInitial = opts.initialPlayer
    ? `${safeSegment(opts.initialPlayer.name)}-waiting`
    : `${safeSegment(sessionId)}-waiting`;

  let directory = path.join(LOG_ROOT, mode, `${labelInitial}-${dirSafeTimestamp(startedAtDate)}`);
  fs.mkdirSync(directory, { recursive: true });

  const meta: GameMeta = {
    sessionId,
    mode,
    startedAt: startedAtDate.toISOString(),
    startedAtLocal: formatLocalTimestamp(startedAtDate),
    config: undefined as unknown as GameConfig,  // заполнится через setConfig()
    players: opts.initialPlayer ? { [opts.initialPlayer.color]: opts.initialPlayer } : {},
    totals: { turnsPlayed: 0, moves: 0 },
  };

  let logFile = path.join(directory, 'game.log.jsonl');
  const metaFile = () => path.join(directory, 'meta.json');

  function writeMeta() {
    try {
      fs.writeFileSync(metaFile(), JSON.stringify(meta, null, 2), 'utf8');
    } catch (err) {
      console.warn('[gameRecorder] failed to write meta', err);
    }
  }

  function renameDirIfBothKnown() {
    const red = meta.players.red;
    const blue = meta.players.blue;
    if (!red || !blue) return;
    const nextLabel = `${safeSegment(red.name)}-${safeSegment(blue.name)}`;
    const nextDir = path.join(LOG_ROOT, mode, `${nextLabel}-${dirSafeTimestamp(startedAtDate)}`);
    if (nextDir === directory) return;
    try {
      if (!fs.existsSync(nextDir)) {
        fs.renameSync(directory, nextDir);
      } else {
        fs.mkdirSync(nextDir, { recursive: true });
      }
      directory = nextDir;
      logFile = path.join(directory, 'game.log.jsonl');
    } catch (err) {
      console.warn('[gameRecorder] failed to rename dir', err);
    }
  }

  function emit(kind: GameEventKind, payload: Omit<GameEvent, 'ts' | 'tsLocal' | 't' | 'kind'>) {
    const now = new Date();
    const ev: GameEvent = {
      ts: now.toISOString(),
      tsLocal: formatLocalTimestamp(now),
      t: now.getTime() - startedAtDate.getTime(),
      kind,
      ...payload,
    };
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.appendFileSync(logFile, `${JSON.stringify(ev)}\n`, 'utf8');
    } catch (err) {
      console.warn('[gameRecorder] failed to append event', err);
    }
    meta.totals.moves += 1;
    writeMeta();
  }

  writeMeta();

  const recorder: GameRecorder = {
    sessionId,
    get directory() { return directory; },
    meta,

    setPlayer(player) {
      meta.players[player.color] = { ...meta.players[player.color], ...player };
      renameDirIfBothKnown();
      writeMeta();
    },
    setConfig(config) {
      meta.config = config;
      writeMeta();
    },
    setPlayerUserId(color, userId) {
      if (meta.players[color]) {
        meta.players[color]!.userId = userId;
      }
    },

    setupMine(color, row, col, hasMine, minesPlaced) {
      emit('setup_mine', { actor: color, row, col, hasMine, minesPlaced });
    },
    setupConfirmed(color, minesPlaced) {
      emit('setup_confirmed', { actor: color, minesPlaced });
    },
    gameStarted(firstPlayer) {
      emit('game_started', { actor: firstPlayer });
    },
    zoneSelect(color, click, display, action, timeLeftMs) {
      emit('zone_select', {
        actor: color,
        clicked: click,
        displayZone: display,
        actionZone: action,
        timeLeftMs,
      });
    },
    cellOpen(color, row, col, opts) {
      emit('cell_open', {
        actor: color, row, col,
        viaChord: !!opts?.viaChord,
        viaDefuse: !!opts?.viaDefuse,
        timeLeftMs: opts?.timeLeftMs,
      });
    },
    mineHit(color, row, col, livesLeft, opts) {
      emit('mine_hit', {
        actor: color, row, col,
        livesLeft,
        viaChord: !!opts?.viaChord,
        timeLeftMs: opts?.timeLeftMs,
      });
    },
    mineDefused(color, row, col, hadMine, opts) {
      emit('mine_defused', {
        actor: color, row, col,
        hadMine,
        timeLeftMs: opts?.timeLeftMs,
      });
    },
    phase3Mine(color, row, col, opts) {
      emit('phase3_mine', {
        actor: color, row, col,
        timeLeftMs: opts?.timeLeftMs,
      });
    },
    turnEnd(color, opts) {
      if (opts && typeof opts.turnsPlayed === 'number') {
        meta.totals.turnsPlayed = opts.turnsPlayed;
      } else {
        meta.totals.turnsPlayed += 1;
      }
      emit('turn_end', {
        actor: color,
        timeLeftMs: opts?.timeLeftMs,
        turnsPlayed: meta.totals.turnsPlayed,
      });
    },
    gameFinished(winner, reason) {
      const endedAt = new Date();
      meta.endedAt = endedAt.toISOString();
      meta.endedAtLocal = formatLocalTimestamp(endedAt);
      meta.durationMs = endedAt.getTime() - startedAtDate.getTime();
      meta.result = { winner, reason };
      emit('game_finished', { actor: winner ?? undefined, winner, reason, durationMs: meta.durationMs });

      // Report to API (non-blocking, non-fatal) — skip aborted games
      if (reason !== 'aborted') {
        reportGameToApi(meta, directory).catch((err: unknown) => {
          console.warn('[gameRecorder] reportGameToApi failed:', err);
        });
      }
    },
    appendAux(auxKind, details) {
      const now = new Date();
      const rec = {
        ts: now.toISOString(),
        tsLocal: formatLocalTimestamp(now),
        t: now.getTime() - startedAtDate.getTime(),
        kind: auxKind,
        ...(details ?? {}),
      };
      try {
        fs.mkdirSync(directory, { recursive: true });
        fs.appendFileSync(path.join(directory, 'aux.log.jsonl'), `${JSON.stringify(rec)}\n`, 'utf8');
      } catch (err) {
        console.warn('[gameRecorder] failed to append aux event', err);
      }
    },
  };

  return recorder;
}
