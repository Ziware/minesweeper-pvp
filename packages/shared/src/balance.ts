/**
 * Типизация и производные значения центрального конфига баланса игры.
 *
 * Источник правды — [`balance.config.json`](packages/shared/src/balance.config.json:1).
 * После правки JSON-файла запустите `yarn balance:gen` в корне репозитория
 * (или просто `yarn dev`/`yarn build` — кодоген вызывается автоматически).
 *
 * Скрипт [`gen-balance.js`](packages/shared/scripts/gen-balance.js:1) превращает
 * JSON в TS-модуль [`balance.generated.ts`](packages/shared/src/balance.generated.ts:1),
 * который и импортируется ниже. Это позволяет работать единообразно во всех
 * окружениях (Vite, tsc, ts-node-dev, Docker) без зависимости от поддержки
 * `resolveJsonModule` в runtime-загрузчиках.
 */
import { BALANCE_DATA } from './balance.generated';
import type { TimeControl } from './types';

export interface BalanceTimeControlPreset {
  /** Человекочитаемый ярлык, например "3 + 5". */
  label: string;
  /** Базовое время в минутах. */
  baseMinutes: number;
  /** Прибавка за ход в секундах. */
  incrementSeconds: number;
}

export interface BalanceConfig {
  board: {
    /** Размер квадратного игрового поля. */
    size: number;
    /** Сколько мин расставляет красный игрок в фазе подготовки. */
    initialMinesRed: number;
    /** Сколько мин расставляет синий игрок в фазе подготовки. */
    initialMinesBlue: number;
  };
  player: {
    /** Стартовое количество жизней. */
    maxLives: number;
  };
  phase3: {
    /** Базовое количество мин, которое игрок может поставить в фазе 3. */
    minesPerTurn: number;
    /**
     * Дополнительные мины в фазе 3, если зона действия 5×5 на фазе 1
     * содержала хотя бы одну клетку штаба игрока (защитная зона).
     */
    hqInActionZoneBonusMines: number;
  };
  defuse: {
    /** Стартовый лимит разминирований на ход. */
    initialPerTurn: number;
    /**
     * Каждые N совместных ходов оба игрока получают +1 к лимиту разминирований.
     */
    grantInterval: number;
  };
  timeControls: {
    /** Индекс пресета, выбираемого по умолчанию в лобби. */
    defaultPresetIndex: number;
    /** Доступные пресеты шахматных часов. */
    presets: BalanceTimeControlPreset[];
  };
}

export const BALANCE: BalanceConfig = BALANCE_DATA as unknown as BalanceConfig;

// ─── Удобные производные значения ───────────────────────────────────────────

/** Пресеты, нормализованные в `TimeControl` (миллисекунды). */
export const TIME_CONTROL_PRESETS: Array<{ label: string; timeControl: TimeControl }> =
  BALANCE.timeControls.presets.map((p) => ({
    label: p.label,
    timeControl: {
      baseMs:      p.baseMinutes * 60_000,
      incrementMs: p.incrementSeconds * 1_000,
    },
  }));

/**
 * Sentinel-проверка «без таймера». Передавать `Infinity` по сокету нельзя
 * (JSON превратит в `null`), поэтому шахматные часы с `baseMs === 0`
 * трактуются как «бесконечные»: UI рисует ∞, сервер не тратит время и
 * не проверяет timeout.
 */
export function isUntimedControl(tc: TimeControl): boolean {
  return tc.baseMs === 0;
}

/** Контроль времени по умолчанию (выбран `defaultPresetIndex`). */
export const DEFAULT_TIME_CONTROL: TimeControl =
  TIME_CONTROL_PRESETS[BALANCE.timeControls.defaultPresetIndex].timeControl;

/** Перечень разрешённых TimeControl-комбинаций для валидации на сервере. */
export const ALLOWED_TIME_CONTROLS: TimeControl[] =
  TIME_CONTROL_PRESETS.map((p) => p.timeControl);

/** Текст со списком пресетов, например "2+3, 3+5 или 5+7". */
export function formatTimeControlPresetsList(): string {
  const labels = BALANCE.timeControls.presets.map((p) => p.label.replace(/\s+/g, ''));
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} или ${labels[labels.length - 1]}`;
}

/**
 * Сколько совместных ходов всего длится партия в формате «по N у каждого».
 * Используется только для текстовых описаний, не влияет на логику.
 */
export function defuseGrantIntervalLabel(): string {
  return String(BALANCE.defuse.grantInterval);
}
