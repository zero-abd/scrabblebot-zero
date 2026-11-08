// Fast word lookup: each word is pre-scored and summarized as a letter bitmask
// plus letter counts, so most words are rejected with one AND.

const VALUE: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

export function scoreOf(word: string): number {
  let base = 0;
  for (const c of word) base += VALUE[c] ?? 0;
  const len = word.length;
  // Same integer math as the module: base * num / denom.
  if (len <= 3) return base;
  if (len === 4) return Math.floor((base * 3) / 2);
  if (len === 5) return base * 2;
  if (len === 6) return Math.floor((base * 5) / 2);
  return base * 3;
}

export interface Entry {
  word: string;
  len: number;
  mask: number;
  counts: Uint8Array;
  score: number;
}

export interface WordIndex {
  byScore: Entry[]; // highest score first
}

const cache = new WeakMap<string[], WordIndex>();

export function indexFor(dictionary: string[]): WordIndex {
  let idx = cache.get(dictionary);
  if (idx) return idx;
  const byScore: Entry[] = [];
  for (const word of dictionary) {
    if (!/^[A-Z]{2,}$/.test(word)) continue;
    const counts = new Uint8Array(26);
    let mask = 0;
    for (let i = 0; i < word.length; i++) {
      const s = word.charCodeAt(i) - 65;
      counts[s]!++;
      mask |= 1 << s;
    }
    byScore.push({ word, len: word.length, mask, counts, score: scoreOf(word) });
  }
  byScore.sort((a, b) => b.score - a.score || b.len - a.len);
  idx = { byScore };
  cache.set(dictionary, idx);
  return idx;
}

export interface RackCounts {
  counts: Uint8Array;
  mask: number;
  total: number;
}

export function rackCounts(rack: Map<string, number>): RackCounts {
  const counts = new Uint8Array(26);
  let mask = 0;
  let total = 0;
  for (const [c, n] of rack) {
    if (n <= 0) continue;
    const s = c.charCodeAt(0) - 65;
    if (s < 0 || s > 25) continue;
    counts[s] = Math.min(255, counts[s]! + n);
    mask |= 1 << s;
    total += n;
  }
  return { counts, mask, total };
}

export function fits(e: Entry, r: RackCounts): boolean {
  if (e.len > r.total || (e.mask & ~r.mask) !== 0) return false;
  for (let s = 0; s < 26; s++) if (e.counts[s]! > r.counts[s]!) return false;
  return true;
}

// Highest-scoring word the rack can spell, optionally with a minimum length.
export function bestWord(idx: WordIndex, r: RackCounts, minLen = 2): Entry | undefined {
  for (const e of idx.byScore) if (e.len >= minLen && fits(e, r)) return e;
  return undefined;
}
