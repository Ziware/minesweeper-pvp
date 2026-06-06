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
    // Максимально ослабленный «новичок»: бот делает «безопасные» ходы
    // ровно настолько, чтобы не сливаться сразу на certain-mine, но почти
    // всё остальное игнорирует.
    //
    // Параметры подобраны так, чтобы бот:
    //   • не запускал MCTS (greedyOnly), не имел сложной дедукции
    //     (trivial → видит только N=0 / N=all-mines, без 1-2-1 и subset);
    //   • в 70 % случаев пропускал ЛЮБОЙ forced-слой политики
    //     (forced-safe-capture, forced-mine-defuse, trivial-chord,
    //     aggressive defuse). То есть видит очевидный безопасный ход —
    //     и НЕ делает его в 70 % случаев. Это уровень «играю первый раз».
    //   • в 35 % случаев досрочно завершает фазу, не доходя до конца хода.
    //   • НЕ использует chord (useChord:false) — chord даёт сразу несколько
    //     безопасных капчур, а новичок про эту механику не знает.
    //   • Берёт капчуры с pMine до 0.50 (50 % шанс мины) — регулярно
    //     теряет жизни. Defuse порог 0.65 — почти никогда не разминирует
    //     уверенно.
    //   • rootActionTemperature 0.7 + rolloutTemperature 0.7 → даже среди
    //     ходов одного слоя выбор сильно случайный.
    //   • setupHeuristicNoise 0.7 → расстановка стартовых мин почти
    //     случайная.
    simulationBudget: 150,
    maxThinkMs: 100,
    greedyOnly: true,
    deductionLevel: 'trivial',
    layoutSamples: 2,
    rolloutDepth: 1,
    uctC: 1.6,
    phase1TopK: 3,
    phase3TopK: 3,
    rolloutPolicy: 'weightedRandom',
    rolloutTemperature: 0.70,
    opponentModel: 'weak',
    rootActionTemperature: 0.70,
    dangerThresholdCapture: 0.50,
    dangerThresholdDefuse: 0.65,
    useChord: false,
    assumeOpponentMaxesMines: false,
    setupHeuristicNoise: 0.70,
    blunderRate: 0.70,
    earlyEndPhaseRate: 0.35,
  },
  normal: {
    // Уровень «крепкий любитель»: уже видит явные паттерны и думает MCTS,
    // но регулярно ошибается:
    //   • subset-дедукция вместо full — ловит 1-2-1, но НЕ решает
    //     полную CSP-цепочку. Сложные позиции пропускает.
    //   • opponentModel: 'mirror' — соперник в симуляциях такой же как мы,
    //     не идеальный.
    //   • 30 % шанс пропустить forced слой; 18 % шанс досрочного
    //     завершения фазы — заметно чаще, чем было раньше (было 15/10).
    //   • dangerThresholdCapture: 0.35 — спокойно лезет в риск.
    //   • rootActionTemperature: 0.35 — частые «ошибки на ровном месте».
    //   • setupHeuristicNoise: 0.4 — стартовая расстановка с шумом.
    simulationBudget: 500,
    maxThinkMs: 350,
    deductionLevel: 'subset',
    layoutSamples: 4,
    rolloutDepth: 3,
    uctC: 1.1,
    phase1TopK: 5,
    phase3TopK: 5,
    rolloutPolicy: 'greedyWithJitter',
    rolloutTemperature: 0.30,
    opponentModel: 'mirror',
    rootActionTemperature: 0.35,
    dangerThresholdCapture: 0.35,
    dangerThresholdDefuse: 0.50,
    useChord: true,
    assumeOpponentMaxesMines: false,
    setupHeuristicNoise: 0.40,
    blunderRate: 0.30,
    earlyEndPhaseRate: 0.18,
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
