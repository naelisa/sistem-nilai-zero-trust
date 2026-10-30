function toHuruf(n) {
  if (n >= 85) return 'A';
  if (n >= 70) return 'B';
  if (n >= 55) return 'C';
  if (n >= 40) return 'D';
  return 'E';
}
const BOBOT = { A: 4, B: 3, C: 2, D: 1, E: 0 };
module.exports = { toHuruf, BOBOT };
