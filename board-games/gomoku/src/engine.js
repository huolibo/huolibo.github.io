import { SIZE, directions, inside, legalMoves, winningLine } from './rules.js';

// Independent lightweight implementation; design references are in RESEARCH.md.
// Score all five-cell windows, including broken shapes, rather than only runs.
const WIN = 1e9, WEIGHTS = [0, 2, 18, 240, 18000, 10000000];
const windows = [];
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
  for (const [dx, dy] of directions) if (inside(x + 4 * dx, y + 4 * dy)) {
    windows.push(Array.from({ length: 5 }, (_, i) => (y + i * dy) * SIZE + x + i * dx));
  }
}
const through = Array.from({ length: 225 }, () => []);
for (const cells of windows) for (const index of cells) through[index].push(cells);

function scoreBoard(board, side) {
  let value = 0;
  for (const cells of windows) {
    let mine = 0, theirs = 0;
    for (const i of cells) { if (board[i] === side) mine++; else if (board[i] === -side) theirs++; }
    if (!theirs) value += WEIGHTS[mine];
    if (!mine) value -= WEIGHTS[theirs];
  }
  return value;
}
function pointValue(board, index, side) {
  let value = 0;
  for (const cells of through[index]) {
    let count = 1, blocked = false;
    for (const i of cells) { if (board[i] === -side) { blocked = true; break; } if (board[i] === side) count++; }
    if (!blocked) value += WEIGHTS[count];
  }
  return value;
}
function candidates(board, side, limit = 12) {
  const nearby = new Set(), wins = [], blocks = [];
  for (let i = 0; i < 225; i++) {
    if (board[i]) {
      const x = i % SIZE, y = Math.floor(i / SIZE);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy, index = ny * SIZE + nx;
        if (inside(nx, ny) && !board[index]) nearby.add(index);
      }
    }
  }
  if (!nearby.size) return board.every(v => !v) ? [112] : [];
  const ranked = [];
  for (const i of nearby) {
    board[i] = side; if (winningLine(board, i, side).length) wins.push(i);
    board[i] = -side; if (winningLine(board, i, -side).length) blocks.push(i);
    board[i] = 0;
    ranked.push({ i, score: pointValue(board, i, side) + pointValue(board, i, -side) * 1.1 });
  }
  // Never prune immediate wins or forced defenses out of the search.
  if (wins.length) return wins;
  if (blocks.length) return blocks;
  return ranked.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map(x => x.i);
}

export function search(input, side, { milliseconds = 3000, maxDepth = 6, now = () => performance.now(), onProgress = () => {} } = {}) {
  const board = [...input], started = now(), deadline = started + Math.max(1, milliseconds);
  const fallback = legalMoves(board, side)[0];
  if (!fallback) return { move: null, depth: 0, score: 0, nodes: 0, elapsed: 0 };
  let best = { move: fallback, depth: 0, score: null, nodes: 0 }, nodes = 0;
  const STOP = Symbol('deadline');
  const checkTime = () => { if (now() >= deadline) throw STOP; };
  onProgress({ ...best });
  function negamax(turn, depth, alpha, beta, ply) {
    checkTime(); nodes++;
    if (depth === 0) return scoreBoard(board, turn);
    const moves = candidates(board, turn);
    if (!moves.length) return 0;
    let score = -Infinity;
    for (const to of moves) {
      checkTime(); board[to] = turn;
      let value;
      try { value = winningLine(board, to, turn).length ? WIN - ply : -negamax(-turn, depth - 1, -beta, -alpha, ply + 1); }
      finally { board[to] = 0; }
      score = Math.max(score, value); alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return score;
  }
  try {
    checkTime(); const roots = candidates(board, side, 18);
    best.move = { from: -1, to: roots[0] ?? fallback.to }; onProgress({ ...best });
    for (let depth = 1; depth <= maxDepth; depth++) {
      let score = -Infinity, chosen = best.move.to;
      const ordered = [best.move.to, ...roots.filter(i => i !== best.move.to)];
      for (const to of ordered) {
        checkTime(); board[to] = side;
        let value;
        try { value = winningLine(board, to, side).length ? WIN : -negamax(-side, depth - 1, -Infinity, -score, 1); }
        finally { board[to] = 0; }
        if (value > score) { score = value; chosen = to; }
      }
      best = { move: { from: -1, to: chosen }, depth, score, nodes }; onProgress({ ...best });
      if (Math.abs(score) >= WIN - 225) break;
    }
  } catch (error) { if (error !== STOP) throw error; }
  return { ...best, nodes, elapsed: now() - started };
}
