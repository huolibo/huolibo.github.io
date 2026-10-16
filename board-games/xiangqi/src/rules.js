// Board coordinates: black's back rank is y=0; red's is y=9.
export const RED = 1, BLACK = -1;
export const names = { 1: '帅', 2: '仕', 3: '相', 4: '马', 5: '车', 6: '炮', 7: '兵', '-1': '将', '-2': '士', '-3': '象', '-4': '马', '-5': '车', '-6': '炮', '-7': '卒' };
export const sideName = side => side === RED ? '红方' : '黑方';
export const coord = i => `${'九八七六五四三二一'[i % 9]}路${10 - Math.floor(i / 9)}`;
export const inBoard = (x, y) => x >= 0 && x < 9 && y >= 0 && y < 10;
const palace = (x, y, side) => x >= 3 && x <= 5 && (side === RED ? y >= 7 && y <= 9 : y >= 0 && y <= 2);
export function initialBoard() {
  const b = Array(90).fill(0), rank = [5, 4, 3, 2, 1, 2, 3, 4, 5];
  for (let x = 0; x < 9; x++) { b[x] = -rank[x]; b[81 + x] = rank[x]; }
  b[19] = b[25] = -6; b[64] = b[70] = 6;
  for (let x = 0; x < 9; x += 2) { b[27 + x] = -7; b[54 + x] = 7; }
  return b;
}
export function pseudoMoves(b, from) {
  const p = b[from]; if (!p) return [];
  const side = Math.sign(p), kind = Math.abs(p), x = from % 9, y = Math.floor(from / 9), out = [];
  const add = (nx, ny) => { if (inBoard(nx, ny) && Math.sign(b[ny * 9 + nx]) !== side) out.push(ny * 9 + nx); };
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (kind === 1) {
    for (const [dx, dy] of dirs) if (palace(x + dx, y + dy, side)) add(x + dx, y + dy);
    for (const dy of [-1, 1]) for (let ny = y + dy; inBoard(x, ny); ny += dy) {
      const target = b[ny * 9 + x]; if (target) { if (target === -side) add(x, ny); break; }
    }
  } else if (kind === 2) {
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) if (palace(x + dx, y + dy, side)) add(x + dx, y + dy);
  } else if (kind === 3) {
    for (const dx of [-2, 2]) for (const dy of [-2, 2]) {
      const nx = x + dx, ny = y + dy;
      if (inBoard(nx, ny) && (side === RED ? ny >= 5 : ny <= 4) && !b[(y + dy / 2) * 9 + x + dx / 2]) add(nx, ny);
    }
  } else if (kind === 4) {
    for (const [dx, dy] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]]) {
      const lx = x + (Math.abs(dx) === 2 ? Math.sign(dx) : 0), ly = y + (Math.abs(dy) === 2 ? Math.sign(dy) : 0);
      if (inBoard(lx, ly) && !b[ly * 9 + lx]) add(x + dx, y + dy);
    }
  } else if (kind === 5 || kind === 6) {
    for (const [dx, dy] of dirs) {
      let screen = false;
      for (let nx = x + dx, ny = y + dy; inBoard(nx, ny); nx += dx, ny += dy) {
        const target = b[ny * 9 + nx];
        if (kind === 5) { add(nx, ny); if (target) break; }
        else if (!screen) { if (!target) add(nx, ny); else screen = true; }
        else if (target) { add(nx, ny); break; }
      }
    }
  } else if (kind === 7) {
    add(x, y - side);
    if (side === RED ? y <= 4 : y >= 5) { add(x - 1, y); add(x + 1, y); }
  }
  return out;
}
export function moved(b, move) { const n = b.slice(); n[move.to] = n[move.from]; n[move.from] = 0; return n; }
export function inCheck(b, side) {
  const king = b.indexOf(side); if (king < 0) return true;
  for (let i = 0; i < 90; i++) if (Math.sign(b[i]) === -side && pseudoMoves(b, i).includes(king)) return true;
  return false;
}
export function legalMoves(b, side, onlyFrom = null) {
  const out = [];
  if (!b.includes(side) || !b.includes(-side)) return out;
  for (let from = 0; from < 90; from++) {
    if (onlyFrom !== null && onlyFrom !== from || Math.sign(b[from]) !== side) continue;
    for (const to of pseudoMoves(b, from)) {
      const move = { from, to };
      if (!inCheck(moved(b, move), side)) out.push(move);
    }
  }
  return out;
}
export const positionKey = (b, turn) => `${b.join(',')}/${turn}`;
export function moveLabel(b, move) {
  const files = 'abcdefghi';
  const square = i => `${files[i % 9]}${10 - Math.floor(i / 9)}`;
  return `${names[b[move.from]]} ${square(move.from)} → ${square(move.to)}${b[move.to] ? ` · 吃${names[b[move.to]]}` : ''}`;
}
