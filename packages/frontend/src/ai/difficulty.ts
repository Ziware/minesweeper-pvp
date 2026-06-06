/**
 * Difficulty presets for the AI bot.
 *
 * The exact numbers come from plans/ai-bot/04-difficulty-levels.md. Tuning
 * dial is `simulationBudget` (linear in cost). All three levels share the
 * same engine; only these knobs change.
 *
 * NOTE on the MVP cut: we run MCTS on the main thread (via a worker — see
 * `bot-worker.ts`). To keep response times reasonable on mid-range laptops,
 * the initial budgets are intentionally moderate. They can be raised later
 * without changing any public API.
 */

import type { BotConfig, Difficulty } from './types';

// Budgets are wall-clock first. `simulationBudget` is a generous upper bound;
// the search will stop early at `maxThinkMs` so the UI never freezes. Numbers
// reflect measured cost on a 12×12 board where every micro-step does a full
// `cloneState` + `enumerateMoves` + leaf eval (~0.2-0.5 ms each).
export const DIFFICULTY_PRESETS: Record<Difficulty, BotConfig> = {
  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ Difficulty design goals:                                             │
  // │   easy   — посилен ВСЕМ. Бот не делает откровенно тупых самоубийств │
  // │            (никогда не лезет в certain-mine, не пропускает forced   │
  // │            certain-safe), но во всём остальном много шумит и        │
  // │            ошибается. Регулярно проходимый.                         │
  // │   normal — золотая середина: full-дедукция и greedy роллауты, но    │
  // │            заметно меньше времени на размышление и больше шума в    │
  // │            корне поиска + setup-плейсере. Серьёзный, но играбельный.│
  // │   hard   — играет на максимум: full-дедукция, длинные роллауты,     │
  // │            большой бюджет симуляций, никакого шума на root, идеально│
  // │            оптимизированная setup-расстановка.                      │
  // │                                                                      │
  // │ Базовая логика (forced moves, gamble-capture, rush-detection, и т.п.│
  // │ из patterns/policy.ts) одинакова для всех уровней — она гарантирует │
  // │ что бот не «слетает с катушек» даже на easy. Differentiator        │
  // │ исключительно в качестве MCTS-поиска и количестве «шума».          │
  // └──────────────────────────────────────────────────────────────────────┘
  easy: {
    // Думает максимум 200 мс и ходит почти по чистому prior'у.
    // НО: greedyOnly: true — MCTS вообще не запускается, бот идёт на
    // первый кандидат отсортированного по приору списка.
    // С большим rootActionTemperature (0.45) и rolloutTemperature (0.55)
    // даже отбор кандидатов сильно зашумлён — бот часто выбирает
    // 2-й/3-й лучший вариант. dangerThresholdCapture поднят до 0.40 —
    // бот регулярно лезет в спорные клетки и теряет жизни, делая партии
    // короткими и проходимыми.
    simulationBudget: 200,
    maxThinkMs: 150,
    greedyOnly: true,
    deductionLevel: 'trivial',
    layoutSamples: 3,
    rolloutDepth: 2,
    uctC: 1.4,
    phase1TopK: 4,
    phase3TopK: 4,
    rolloutPolicy: 'weightedRandom',
    rolloutTemperature: 0.55,
    opponentModel: 'weak',
    rootActionTemperature: 0.45,
    dangerThresholdCapture: 0.40,
    dangerThresholdDefuse: 0.55,
    useChord: true,
    assumeOpponentMaxesMines: false,
    setupHeuristicNoise: 0.45,
    // Намеренные ошибки easy-бота:
    //   • 40 % шанс пропустить каждый «forced» слой политики — то есть
    //     не сделать форсированный безопасный захват / forced-defuse /
    //     trivial-chord; бот «не заметит» очевидную выгоду.
    //   • 20 % шанс досрочно закончить фазу даже если есть осмысленные
    //     ходы — «человек решил, что хватит на сегодня».
    blunderRate: 0.40,
    earlyEndPhaseRate: 0.2,
  },
  normal: {
    // Бот того же стиля что hard (full-дедукция, greedyWithJitter,
    // strong opponentModel), но с тремя ключевыми ослаблениями:
    //   • simulationBudget / maxThinkMs / layoutSamples / rolloutDepth /
    //     topK заметно урезаны — MCTS-дерево мельче, оценка позиций
    //     более шумная.
    //   • rootActionTemperature: 0.18 — бот иногда выбирает не самый
    //     посещаемый, а слегка менее посещаемый узел. Это вносит
    //     «ошибки на ровном месте» без слива на certain-mine.
    //   • setupHeuristicNoise: 0.25 — начальная расстановка мин менее
    //     отточенная.
    //   • dangerThresholdCapture: 0.28 — чуть охотнее лезет в риск.
    simulationBudget: 600,
    maxThinkMs: 400,
    deductionLevel: 'full',
    layoutSamples: 5,
    rolloutDepth: 3,
    uctC: 1.0,
    phase1TopK: 6,
    phase3TopK: 5,
    rolloutPolicy: 'greedyWithJitter',
    rolloutTemperature: 0.25,
    opponentModel: 'mirror',
    rootActionTemperature: 0.18,
    dangerThresholdCapture: 0.28,
    dangerThresholdDefuse: 0.45,
    useChord: true,
    assumeOpponentMaxesMines: true,
    setupHeuristicNoise: 0.25,
    // Намеренные ошибки medium-бота — заметно реже чем у easy:
    //   • 15 % шанс пропустить forced слой;
    //   • 10 % шанс досрочно закончить фазу.
    blunderRate: 0.15,
    earlyEndPhaseRate: 0.10,
  },
  hard: {
    // Максимальная сила: длинные роллауты, много определёнок,
    // широкий top-K, никакого root-temperature шума, идеальная
    // setup-расстановка, низкие пороги опасности.
    simulationBudget: 2500,
    maxThinkMs: 1500,
    deductionLevel: 'full',
    layoutSamples: 10,
    rolloutDepth: 5,
    uctC: 0.9,
    phase1TopK: 12,
    phase3TopK: 10,
    rolloutPolicy: 'greedyWithJitter',
    rolloutTemperature: 0.10,
    opponentModel: 'strong',
    rootActionTemperature: 0.0,
    dangerThresholdCapture: 0.18,
    dangerThresholdDefuse: 0.38,
    useChord: true,
    assumeOpponentMaxesMines: true,
    setupHeuristicNoise: 0.0,
    // Hard никогда не делает «намеренные ошибки».
    blunderRate: 0.0,
    earlyEndPhaseRate: 0.0,
  },
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '🟢 Лёгкий',
  normal: '🟡 Средний',
  hard: '🔴 Сложный',
};

/** Per-action display pacing (ms) added on top of worker compute time, so the
 *  human can follow the bot's moves visually. From plans/ai-bot/06-integration.md. */
export const BOT_PACING_MS = {
  select_zone:       700,
  capture_safe:      350,
  capture_mine:      600,
  defuse:            800,
  chord:             500,
  place_mine_phase3: 250,
  end_phase2:        400,
  end_phase3:        400,
  place_mine_setup:  150,
  confirm_setup:     400,
  toggle_mark:       0,
} as const;
