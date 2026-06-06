#!/usr/bin/env node
/**
 * Precalc generator for the bot's pattern library.
 *
 * Produces `packages/frontend/src/ai/patterns/library.generated.ts`,
 * a static catalog of resolved 1×3 and 2×3 number-patterns. Each entry
 * encodes the certain-mine / certain-safe / mine-probability output that
 * the runtime CSP in `deduce.ts` must reproduce for that pattern.
 *
 * Run:
 *   yarn workspace @minesweeper-pvp/frontend precalc:patterns
 *
 * The output is committed (small, deterministic). Regenerate whenever the
 * pattern model changes.
 *
 * Pattern model
 * -------------
 * 1×3: three contiguous own numbered cells in a row, all sharing a covered
 * enemy strip of length 5 along one side. The five strip cells are the
 * variables; constraints are:
 *   N1 covers {0,1,2}, N2 covers {1,2,3}, N3 covers {2,3,4}
 *
 * 2×3: two such rows stacked, each constraining its own length-5 strip
 * (the strips are disjoint — middle row neighbours are simplified out so
 * the library stays compact). The 10 vars decompose into two independent
 * 1×3 problems; the catalog only retains entries where BOTH halves carry
 * non-trivial info (otherwise it's two redundant 1×3 entries).
 */

const fs = require('fs');
const path = require('path');

// ─── CSP solver (mirrors deduce.ts) ─────────────────────────────────────────

function solve(nVars, rawConstraints) {
  const constraints = rawConstraints.map((c) => ({ vars: new Set(c.vars), rhs: c.rhs }));
  const determined = new Map();
  const mines = new Set();
  const safes = new Set();

  const apply = (v, val) => {
    if (determined.has(v)) return false;
    determined.set(v, val);
    if (val === 1) mines.add(v); else safes.add(v);
    for (const c of constraints) {
      if (c.vars.has(v)) {
        c.vars.delete(v);
        if (val === 1) c.rhs--;
      }
    }
    return true;
  };
  const trivial = () => {
    let ch = true;
    while (ch) {
      ch = false;
      for (const c of constraints) {
        if (c.vars.size === 0) continue;
        if (c.rhs <= 0) for (const v of [...c.vars]) if (apply(v, 0)) ch = true;
        else if (c.rhs >= c.vars.size) for (const v of [...c.vars]) if (apply(v, 1)) ch = true;
      }
    }
  };
  trivial();
  // subset
  let ch = true;
  while (ch) {
    ch = false;
    const active = constraints.filter((c) => c.vars.size > 0);
    for (let i = 0; i < active.length; i++) {
      const A = active[i];
      if (A.vars.size === 0) continue;
      for (let j = 0; j < active.length; j++) {
        if (i === j) continue;
        const B = active[j];
        if (B.vars.size === 0 || A.vars.size <= B.vars.size) continue;
        let subset = true;
        for (const v of B.vars) if (!A.vars.has(v)) { subset = false; break; }
        if (!subset) continue;
        const diff = [];
        for (const v of A.vars) if (!B.vars.has(v)) diff.push(v);
        const dR = A.rhs - B.rhs;
        if (dR === 0) for (const v of diff) if (apply(v, 0)) ch = true;
        else if (dR === diff.length) for (const v of diff) if (apply(v, 1)) ch = true;
      }
    }
    if (ch) trivial();
  }

  const probs = new Array(nVars).fill(0.5);
  for (const v of safes) probs[v] = 0;
  for (const v of mines) probs[v] = 1;
  const remaining = [];
  for (let v = 0; v < nVars; v++) if (!determined.has(v)) remaining.push(v);
  if (remaining.length > 0 && remaining.length <= 16) {
    const total = 1 << remaining.length;
    let valid = 0;
    const counts = new Array(remaining.length).fill(0);
    const ridx = new Map();
    remaining.forEach((v, i) => ridx.set(v, i));
    const masks = [];
    for (const c of constraints) {
      if (c.vars.size === 0) continue;
      let m = 0; let ok = true;
      for (const v of c.vars) {
        const i = ridx.get(v);
        if (i === undefined) { ok = false; break; }
        m |= 1 << i;
      }
      if (ok) masks.push({ mask: m, rhs: c.rhs });
    }
    outer:
    for (let m = 0; m < total; m++) {
      for (const c of masks) {
        let s = 0; let x = m & c.mask;
        while (x) { s += x & 1; x >>>= 1; }
        if (s !== c.rhs) continue outer;
      }
      valid++;
      for (let i = 0; i < remaining.length; i++) if (m & (1 << i)) counts[i]++;
    }
    if (valid > 0) {
      for (let i = 0; i < remaining.length; i++) {
        const p = counts[i] / valid;
        const v = remaining[i];
        probs[v] = p;
        if (p === 0) safes.add(v);
        else if (p === 1) mines.add(v);
      }
    }
  }
  return { mines, safes, probs };
}

function describe(probs) {
  return probs.map((p) => (p === 0 ? 'O' : p === 1 ? 'X' : '?')).join('');
}

// ─── 1×3 patterns ───────────────────────────────────────────────────────────

const linePatterns = [];
for (let n1 = 0; n1 <= 3; n1++) {
  for (let n2 = 0; n2 <= 3; n2++) {
    for (let n3 = 0; n3 <= 3; n3++) {
      const constraints = [
        { vars: [0, 1, 2], rhs: n1 },
        { vars: [1, 2, 3], rhs: n2 },
        { vars: [2, 3, 4], rhs: n3 },
      ];
      // Infeasible?
      if (n1 > 3 || n2 > 3 || n3 > 3) continue;
      const { probs } = solve(5, constraints);
      const hasInfo = probs.some((p) => p === 0 || p === 1);
      if (!hasInfo) continue;
      linePatterns.push({
        numbers: [n1, n2, n3],
        cells: describe(probs),
        probs,
      });
    }
  }
}

// ─── 2×3 patterns ───────────────────────────────────────────────────────────

const boxPatterns = [];
for (let n1 = 0; n1 <= 3; n1++) {
  for (let n2 = 0; n2 <= 3; n2++) {
    for (let n3 = 0; n3 <= 3; n3++) {
      for (let n4 = 0; n4 <= 3; n4++) {
        for (let n5 = 0; n5 <= 3; n5++) {
          for (let n6 = 0; n6 <= 3; n6++) {
            const constraints = [
              { vars: [0, 1, 2], rhs: n1 },
              { vars: [1, 2, 3], rhs: n2 },
              { vars: [2, 3, 4], rhs: n3 },
              { vars: [5, 6, 7], rhs: n4 },
              { vars: [6, 7, 8], rhs: n5 },
              { vars: [7, 8, 9], rhs: n6 },
            ];
            const { probs } = solve(10, constraints);
            const top = probs.slice(0, 5);
            const bot = probs.slice(5, 10);
            const topInfo = top.some((p) => p === 0 || p === 1);
            const botInfo = bot.some((p) => p === 0 || p === 1);
            if (!topInfo || !botInfo) continue;
            boxPatterns.push({
              numbers: [[n1, n2, n3], [n4, n5, n6]],
              cells: describe(top) + '|' + describe(bot),
              probs,
            });
          }
        }
      }
    }
  }
}

// ─── Write library.generated.ts ─────────────────────────────────────────────

const header = `/**
 * Auto-generated by \`packages/frontend/scripts/gen-patterns.js\`.
 * DO NOT EDIT — run \`yarn workspace @minesweeper-pvp/frontend precalc:patterns\`
 * (or \`node scripts/gen-patterns.js\` from packages/frontend) to regenerate.
 *
 * Catalog of resolvable 1×3 and 2×3 number patterns. Each entry encodes the
 * canonical deduction the runtime CSP (deduce.ts) must reproduce.
 *
 * Consumed by:
 *   - bot phase-1 zone-priority heuristic (zones overlapping resolvable
 *     patterns get a small prior bonus),
 *   - tests that validate deduce.ts against the catalog.
 */

export interface LinePattern {
  readonly numbers: readonly [number, number, number];
  /** 5 chars: 'X' = certain mine, 'O' = certain safe, '?' = uncertain. */
  readonly cells: string;
  /** P(mine) per cell, length 5. */
  readonly probs: readonly number[];
}

export interface BoxPattern {
  readonly numbers: readonly [readonly [number, number, number], readonly [number, number, number]];
  /** "top|bot" cell descriptors, each 5 chars. */
  readonly cells: string;
  /** P(mine) per cell, length 10 (top 0..4, bot 5..9). */
  readonly probs: readonly number[];
}
`;

const fmt = (n) => {
  if (n === 0) return '0';
  if (n === 1) return '1';
  if (n === 0.5) return '0.5';
  return Number(n.toFixed(4)).toString();
};

let out = header + '\n';
out += `export const LINE_PATTERNS_1x3: readonly LinePattern[] = [\n`;
for (const p of linePatterns) {
  out += `  { numbers: [${p.numbers.join(', ')}], cells: ${JSON.stringify(p.cells)}, probs: [${p.probs.map(fmt).join(', ')}] },\n`;
}
out += '];\n\n';
out += `export const BOX_PATTERNS_2x3: readonly BoxPattern[] = [\n`;
for (const p of boxPatterns) {
  const [top, bot] = p.numbers;
  out += `  { numbers: [[${top.join(', ')}], [${bot.join(', ')}]], cells: ${JSON.stringify(p.cells)}, probs: [${p.probs.map(fmt).join(', ')}] },\n`;
}
out += '];\n\n';
out += `export const PATTERN_LIBRARY_META = {\n`;
out += `  linePatterns_1x3: ${linePatterns.length},\n`;
out += `  boxPatterns_2x3:  ${boxPatterns.length},\n`;
out += `  generatedAt: ${JSON.stringify(new Date().toISOString())},\n`;
out += `} as const;\n`;

const outPath = path.resolve(__dirname, '..', 'src', 'ai', 'patterns', 'library.generated.ts');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out, 'utf-8');

console.log(`[gen-patterns] wrote ${path.relative(process.cwd(), outPath)}`);
console.log(`[gen-patterns]   1×3 patterns: ${linePatterns.length}`);
console.log(`[gen-patterns]   2×3 patterns: ${boxPatterns.length}`);
