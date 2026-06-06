/**
 * Runtime deduction engine for Minesweeper PvP.
 *
 * Given an EngineState (or a determinized layout — same shape) and a
 * perspective colour, returns per-cell mine certainty:
 *   - `certainMine`: enemy cells that *must* contain a mine.
 *   - `certainSafe`: enemy cells that *cannot* contain a mine.
 *   - `pMine`: per-cell probability of a mine for the constraint frontier.
 *
 * Algorithm (in increasing strength):
 *   1. Trivial propagation: for each constraint  Σx = k  with k unknowns,
 *      if k = 0 → all safe; if k = #vars → all mines.
 *   2. Subset rule: for any constraint A ⊃ B with rhs(A) − rhs(B) = |A\B|
 *      (or = 0) we deduce the difference.
 *   3. Brute-force enumeration of small connected components for exact
 *      per-cell probabilities. Components larger than `maxEnumerateSize`
 *      (default 16) are skipped.
 *
 * Cost: O(constraints² · iter) for subset, O(2^k) for enumeration. Sub-ms
 * on a 12×12 board for realistic positions.
 *
 * Inputs are limited to what the bot legitimately sees: numbers on its own
 * revealed cells (these depend only on enemy mines in 8-neighbourhood, and
 * the bot's own flag marks are subtracted out before the CSP is built).
 *
 * Pattern-library validation: see [`precalc.ts`](packages/frontend/src/ai/patterns/precalc.ts:1).
 * The generated [`library.generated.ts`](packages/frontend/src/ai/patterns/library.generated.ts:1)
 * is consumed by tests and by phase-1 zone-priority heuristics — runtime
 * deduction does not need a lookup table since the CSP is already fast.
 */

import { cellKey } from '@minesweeper-pvp/shared';
import type { PlayerColor } from '@minesweeper-pvp/shared';
import type { EngineState } from '../types';

export type DeductionLevel = 'trivial' | 'subset' | 'full';

export interface DeductionInfo {
  /** Per-cell P(mine). Only populated for cells in the constraint frontier.
   *  Certain cells map to exactly 0 or 1. */
  pMine: Map<string, number>;
  certainMine: Set<string>;
  certainSafe: Set<string>;
  /** Enemy cells that are constrained by at least one observed number and
   *  remain undecided after deduction. */
  frontier: Set<string>;
}

export interface DeduceOpts {
  perspective: PlayerColor;
  level: DeductionLevel;
  /** Max variables per connected component for enumeration. */
  maxEnumerateSize?: number;
}

interface Constraint {
  /** Indices into `vars[]`. */
  vars: Set<number>;
  /** Required mine count among `vars`. */
  rhs: number;
}

export function deduce(state: EngineState, opts: DeduceOpts): DeductionInfo {
  const perspective = opts.perspective;
  const enemy: PlayerColor = perspective === 'red' ? 'blue' : 'red';
  const size = state.config.boardSize;
  const myMarks = state.marks[perspective];

  // ─── Build CSP variables + constraints ─────────────────────────────────
  const vars: string[] = [];
  const varIdx = new Map<string, number>();
  const constraints: Constraint[] = [];

  const ensureVar = (r: number, c: number): number => {
    const k = cellKey(r, c);
    let i = varIdx.get(k);
    if (i === undefined) {
      i = vars.length;
      vars.push(k);
      varIdx.set(k, i);
    }
    return i;
  };

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = state.board[r][c];
      if (cell.owner !== perspective) continue;
      if (!cell.isRevealed || cell.number === null) continue;
      const cVars = new Set<number>();
      let flagged = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
          const ncell = state.board[nr][nc];
          if (ncell.owner !== enemy) continue;
          const nk = cellKey(nr, nc);
          if (myMarks[nk] === 'flag') { flagged++; continue; }
          cVars.add(ensureVar(nr, nc));
        }
      }
      const rhs = cell.number - flagged;
      if (cVars.size === 0) continue; // trivially satisfied (or contradictory if rhs!=0; ignore)
      constraints.push({ vars: cVars, rhs });
    }
  }

  const certainMine = new Set<string>();
  const certainSafe = new Set<string>();
  const determined = new Map<number, 0 | 1>();

  const apply = (idx: number, val: 0 | 1): boolean => {
    if (determined.has(idx)) return false;
    determined.set(idx, val);
    if (val === 1) certainMine.add(vars[idx]);
    else certainSafe.add(vars[idx]);
    for (const c of constraints) {
      if (c.vars.has(idx)) {
        c.vars.delete(idx);
        if (val === 1) c.rhs--;
      }
    }
    return true;
  };

  // ─── 1. Trivial propagation ────────────────────────────────────────────
  const propagateTrivial = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of constraints) {
        if (c.vars.size === 0) continue;
        if (c.rhs <= 0) {
          for (const v of [...c.vars]) if (apply(v, 0)) changed = true;
        } else if (c.rhs >= c.vars.size) {
          for (const v of [...c.vars]) if (apply(v, 1)) changed = true;
        }
      }
    }
  };
  propagateTrivial();

  // ─── 2. Subset rule (subset / full) ────────────────────────────────────
  if (opts.level !== 'trivial') {
    let changed = true;
    while (changed) {
      changed = false;
      const active = constraints.filter((c) => c.vars.size > 0);
      for (let i = 0; i < active.length; i++) {
        const A = active[i];
        if (A.vars.size === 0) continue;
        for (let j = 0; j < active.length; j++) {
          if (i === j) continue;
          const B = active[j];
          if (B.vars.size === 0 || A.vars.size <= B.vars.size) continue;
          // B.vars ⊆ A.vars ?
          let subset = true;
          for (const v of B.vars) { if (!A.vars.has(v)) { subset = false; break; } }
          if (!subset) continue;
          const diff: number[] = [];
          for (const v of A.vars) if (!B.vars.has(v)) diff.push(v);
          const dRhs = A.rhs - B.rhs;
          if (dRhs === 0) {
            for (const v of diff) if (apply(v, 0)) changed = true;
          } else if (dRhs === diff.length) {
            for (const v of diff) if (apply(v, 1)) changed = true;
          }
        }
      }
      if (changed) propagateTrivial();
    }
  }

  const pMine = new Map<string, number>();
  const frontier = new Set<string>();
  for (let i = 0; i < vars.length; i++) {
    if (!determined.has(i)) frontier.add(vars[i]);
  }

  // ─── 3. Enumeration of small components (full only) ────────────────────
  if (opts.level === 'full') {
    const maxSize = opts.maxEnumerateSize ?? 16;
    const remaining: number[] = [];
    for (let i = 0; i < vars.length; i++) if (!determined.has(i)) remaining.push(i);

    const adj = new Map<number, Set<number>>();
    for (const v of remaining) adj.set(v, new Set());
    for (const c of constraints) {
      const arr: number[] = [];
      for (const v of c.vars) arr.push(v);
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          adj.get(arr[i])?.add(arr[j]);
          adj.get(arr[j])?.add(arr[i]);
        }
      }
    }

    const seen = new Set<number>();
    for (const start of remaining) {
      if (seen.has(start)) continue;
      const comp: number[] = [];
      const stack = [start];
      while (stack.length) {
        const v = stack.pop()!;
        if (seen.has(v)) continue;
        seen.add(v);
        comp.push(v);
        const ns = adj.get(v);
        if (ns) for (const n of ns) if (!seen.has(n)) stack.push(n);
      }
      if (comp.length === 0 || comp.length > maxSize) continue;

      const compIdx = new Map<number, number>();
      comp.forEach((v, i) => compIdx.set(v, i));
      const compConstraints: Array<{ mask: number; rhs: number }> = [];
      for (const c of constraints) {
        if (c.vars.size === 0) continue;
        let allInside = true;
        let mask = 0;
        for (const v of c.vars) {
          const idx = compIdx.get(v);
          if (idx === undefined) { allInside = false; break; }
          mask |= 1 << idx;
        }
        if (allInside) compConstraints.push({ mask, rhs: c.rhs });
      }

      const n = comp.length;
      const total = 1 << n;
      let valid = 0;
      const counts = new Array<number>(n).fill(0);

      outer:
      for (let m = 0; m < total; m++) {
        for (const c of compConstraints) {
          let sum = 0;
          let x = m & c.mask;
          while (x) { sum += x & 1; x >>>= 1; }
          if (sum !== c.rhs) continue outer;
        }
        valid++;
        for (let v = 0; v < n; v++) if (m & (1 << v)) counts[v]++;
      }

      if (valid === 0) continue;
      for (let v = 0; v < n; v++) {
        const p = counts[v] / valid;
        const key = vars[comp[v]];
        pMine.set(key, p);
        if (p === 0) { certainSafe.add(key); frontier.delete(key); }
        else if (p === 1) { certainMine.add(key); frontier.delete(key); }
      }
    }
  }

  for (const k of certainSafe) pMine.set(k, 0);
  for (const k of certainMine) pMine.set(k, 1);
  for (const k of frontier) if (!pMine.has(k)) pMine.set(k, 0.5);

  return { pMine, certainMine, certainSafe, frontier };
}
