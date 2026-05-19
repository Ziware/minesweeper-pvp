import fs from 'fs';
import path from 'path';
import { PlayerColor } from '@minesweeper-pvp/shared';

interface GameLoggerPlayer {
  color: PlayerColor;
  name: string;
  ip?: string;
}

export type GameLogEvent =
  | 'room_created'
  | 'player_joined'
  | 'session_restored'
  | 'setup_mine_toggled'
  | 'setup_confirmed'
  | 'game_started'
  | 'zone_selected'
  | 'cell_captured'
  | 'mine_exploded'
  | 'cell_defused'
  | 'phase2_ended'
  | 'phase3_mine_placed'
  | 'phase3_ended'
  | 'mark_toggled'
  | 'player_disconnected'
  | 'game_finished'
  | 'room_deleted';

export interface GameLogger {
  readonly roomId: string;
  readonly directory: string;
  setPlayers(players: GameLoggerPlayer[]): void;
  event(event: GameLogEvent, details?: Record<string, unknown>): void;
}

const LOG_ROOT = process.env.GAME_LOG_DIR || path.resolve(process.cwd(), 'logs');

function safeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'unknown';
}

function formatDateForDirectory(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function appendJsonLine(filePath: string, payload: Record<string, unknown>) {
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

export function getClientIp(handshakeAddress?: string, forwardedFor?: string | string[]): string {
  const forwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const firstForwarded = forwarded?.split(',')[0]?.trim();
  return firstForwarded || handshakeAddress || 'unknown';
}

export function createGameLogger(roomId: string, creator: GameLoggerPlayer): GameLogger {
  fs.mkdirSync(LOG_ROOT, { recursive: true });

  const createdAt = new Date();
  let players = [creator];
  let directory = path.join(
    LOG_ROOT,
    `${safeSegment(creator.name)}-waiting-${formatDateForDirectory(createdAt)}`
  );
  fs.mkdirSync(directory, { recursive: true });

  let logFile = path.join(directory, 'game.log.jsonl');
  const metaFile = () => path.join(directory, 'meta.json');

  function writeMeta() {
    fs.writeFileSync(
      metaFile(),
      JSON.stringify({ roomId, createdAt: createdAt.toISOString(), players, directory }, null, 2),
      'utf8'
    );
  }

  function renameDirectoryIfNeeded(nextPlayers: GameLoggerPlayer[]) {
    const red = nextPlayers.find((player) => player.color === 'red');
    const blue = nextPlayers.find((player) => player.color === 'blue');
    if (!red || !blue) return;

    const nextDirectory = path.join(
      LOG_ROOT,
      `${safeSegment(red.name)}-${safeSegment(blue.name)}-${formatDateForDirectory(createdAt)}`
    );

    if (nextDirectory === directory) return;

    if (!fs.existsSync(nextDirectory)) {
      fs.renameSync(directory, nextDirectory);
    } else {
      fs.mkdirSync(nextDirectory, { recursive: true });
    }

    directory = nextDirectory;
    logFile = path.join(directory, 'game.log.jsonl');
  }

  const logger: GameLogger = {
    roomId,
    get directory() {
      return directory;
    },
    setPlayers(nextPlayers) {
      players = nextPlayers;
      renameDirectoryIfNeeded(nextPlayers);
      writeMeta();
    },
    event(event, details = {}) {
      fs.mkdirSync(directory, { recursive: true });
      appendJsonLine(logFile, {
        ts: new Date().toISOString(),
        roomId,
        event,
        players,
        ...details,
      });
      writeMeta();
    },
  };

  logger.event('room_created', { creator });
  return logger;
}
