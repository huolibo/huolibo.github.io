export const SIZE = 15;
export const names = { 1: '●', '-1': '○' };
export const sideName = side => side === 1 ? '黑方' : '白方';
export const initialBoard = () => Array(SIZE * SIZE).fill(0);
export const inCheck = () => false;
export const positionKey = (board, side) => `${board.join(',')}/${side}`;
export const moveLabel = (_board, move) => `${'ABCDEFGHIJKLMNO'[move.to % SIZE]}${SIZE - Math.floor(move.to / SIZE)}`;
export const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
export const inside = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
export function winningLine(board, index, side) {
  if (board[index] !== side || ![1, -1].includes(side)) return [];
  const x = index % SIZE, y = Math.floor(index / SIZE);
  for (const [dx, dy] of directions) {
    const line = [index];
    for (const sign of [-1, 1]) {
      let nx = x + dx * sign, ny = y + dy * sign;
      while (inside(nx, ny) && board[ny * SIZE + nx] === side) {
        line.push(ny * SIZE + nx); nx += dx * sign; ny += dy * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}
export function legalMoves(board, side, from = -1) {
  if (![1, -1].includes(side) || from !== -1) return [];
  const free = [];
  for (let to = 0; to < board.length; to++) if (board[to] === 0) free.push({ from: -1, to });
  // A safe central fallback is ready even if the analysis Worker never replies.
  return free.sort((a, b) => distance(a.to) - distance(b.to));
}
function distance(index) { return Math.abs(index % SIZE - 7) + Math.abs(Math.floor(index / SIZE) - 7); }
