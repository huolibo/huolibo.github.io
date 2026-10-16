import { legalMoves, moved, inCheck } from './rules.js';
const values = [0, 20000, 120, 120, 300, 620, 330, 70];
const TIMEOUT = Symbol('timeout');
export function evaluate(b, side) {
  let score = 0;
  for (let i = 0; i < 90; i++) {
    const p = b[i]; if (!p) continue;
    const s = Math.sign(p), k = Math.abs(p), x = i % 9, y = Math.floor(i / 9), advance = s === 1 ? 9 - y : y;
    let v = values[k];
    if (k === 7) v += advance * 8 + (advance >= 5 ? 50 + (4 - Math.abs(x - 4)) * 6 : 0);
    if (k === 4) v += (4 - Math.abs(x - 4)) * 6;
    if (k === 5 || k === 6) v += (4 - Math.abs(x - 4)) * 2;
    score += v * s;
  }
  return score * side;
}
export function orderedMoves(b, moves, preferred) {
  const priority = m => (preferred && m.from === preferred.from && m.to === preferred.to ? 1000000 : 0) + (b[m.to] ? 10 * values[Math.abs(b[m.to])] - values[Math.abs(b[m.from])] : 0);
  return moves.slice().sort((a, bMove) => priority(bMove) - priority(a));
}
export function search(board, side, { milliseconds = 1000, maxDepth = 12, onProgress = () => {}, now = () => performance.now() } = {}) {
  const start = now(), deadline = start + Math.max(1, milliseconds);
  let nodes = 0, best = null, completed = 0, score = 0;
  const checkTime = () => { if (now() >= deadline) throw TIMEOUT; };
  const roots = orderedMoves(board, legalMoves(board, side));
  if (!roots.length) return { move: null, depth: 0, nodes: 0, score: -30000, elapsed: now() - start };
  best = roots[0];
  onProgress({ move: best, depth: 0, nodes, score: null, elapsed: now() - start });
  function negamax(b, turn, depth, alpha, beta, ply, quiet = 0) {
    nodes++; checkTime();
    if (!b.includes(turn)) return -30000 + ply;
    if (!b.includes(-turn)) return 30000 - ply;
    let moves = legalMoves(b, turn);
    if (!moves.length) return -30000 + ply;
    const checked = inCheck(b, turn);
    if (depth <= 0) {
      const stand = evaluate(b, turn);
      if (quiet >= 2) return stand;
      if (!checked) {
        if (stand >= beta) return stand;
        alpha = Math.max(alpha, stand);
        moves = moves.filter(m => b[m.to]);
        if (!moves.length) return stand;
      }
    }
    let value = depth <= 0 && !checked ? evaluate(b, turn) : -Infinity;
    for (const move of orderedMoves(b, moves)) {
      const v = -negamax(moved(b, move), -turn, depth - 1, -beta, -alpha, ply + 1, depth <= 0 ? quiet + 1 : 0);
      value = Math.max(value, v); alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      let localBest = best, localScore = -Infinity, alpha = -Infinity;
      for (const move of orderedMoves(board, roots, best)) {
        checkTime();
        const v = -negamax(moved(board, move), -side, depth - 1, -Infinity, -alpha, 1);
        if (v > localScore) { localScore = v; localBest = move; }
        alpha = Math.max(alpha, v);
      }
      best = localBest; score = localScore; completed = depth;
      onProgress({ move: best, depth, nodes, score, elapsed: now() - start });
      if (Math.abs(score) > 29000) break;
    } catch (e) { if (e !== TIMEOUT) throw e; break; }
  }
  return { move: best, depth: completed, nodes, score: completed ? score : null, elapsed: now() - start };
}
