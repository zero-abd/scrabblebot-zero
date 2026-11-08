// v2: value each letter by how much it improves the best word the rack can
// spell, blended with a general usefulness prior. Tunable via PARAMS.
import { bestWord, indexFor, rackCounts, type WordIndex } from "./wordindex.js";

export const LETTER_VALUE: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};
const USEFULNESS: Record<string, number> = {
  E: 1.6, A: 1.5, I: 1.4, O: 1.3, U: 0.8,
  S: 1.6, R: 1.5, T: 1.5, N: 1.4, L: 1.3, D: 1.2, C: 1.1, M: 1.1, P: 1.1,
  H: 1.1, G: 1.0, B: 1.0, Y: 1.0, F: 0.9, W: 0.9, X: 0.9, K: 0.8, Z: 0.8,
  V: 0.6, J: 0.5, Q: 0.3,
};
const VOWELS = new Set(["A", "E", "I", "O", "U"]);

export interface Params {
  pace: number;      // coins per remaining tile, scaled
  paceMin: number;
  paceMax: number;
  deltaW: number;    // weight on "how much better my best word gets"
  baseW: number;     // weight on the usefulness prior
  playScore: number; // play any word scoring at least this
  holdTiles: number; // play the best word once the rack reaches this size
  dumpLeft: number;  // play everything once this few tiles are left in the bag
  lowCoins: number;  // play to earn coins below this balance
}

export const PARAMS: Params = {
  pace: 0.8, paceMin: 0.5, paceMax: 4,
  deltaW: 1.0, baseW: 0.6,
  playScore: 12, holdTiles: 10, dumpLeft: 15, lowCoins: 15,
};

let index: WordIndex | null = null;
export function setDictionary(dictionary: string[]) {
  index = indexFor(dictionary);
}

export interface BidContext {
  letter: string;
  myBalance: number;
  myRack: Map<string, number>;
  tilesLeft: number;
}

export function decideBid(ctx: BidContext, p: Params = PARAMS): number {
  const c = ctx.letter;
  let tiles = 0;
  let vowels = 0;
  for (const [l, n] of ctx.myRack) {
    tiles += n;
    if (VOWELS.has(l)) vowels += n;
  }

  let prior = (USEFULNESS[c] ?? 1) * (3 + (LETTER_VALUE[c] ?? 1));
  const vowelShare = tiles > 0 ? vowels / tiles : 0.4;
  if (VOWELS.has(c)) {
    if (vowelShare < 0.3) prior *= 1.5;
    else if (vowelShare > 0.55) prior *= 0.5;
  } else if (vowelShare > 0.55) {
    prior *= 1.3;
  }
  if ((ctx.myRack.get(c) ?? 0) >= 2 && c !== "E" && c !== "S") prior *= 0.4;
  if (c === "Q" && (ctx.myRack.get("U") ?? 0) === 0) prior *= 0.3;

  let delta = 0;
  if (index) {
    const before = bestWord(index, rackCounts(ctx.myRack))?.score ?? 0;
    const withIt = new Map(ctx.myRack);
    withIt.set(c, (withIt.get(c) ?? 0) + 1);
    const after = bestWord(index, rackCounts(withIt))?.score ?? 0;
    delta = Math.max(0, after - before);
  }

  const worth = delta * p.deltaW + prior * p.baseW;
  const left = Math.max(1, ctx.tilesLeft);
  const pace = Math.min(p.paceMax, Math.max(p.paceMin, (ctx.myBalance / left) * p.pace));
  return Math.max(0, Math.min(Math.round(worth * pace), ctx.myBalance));
}

export interface WordContext {
  myRack: Map<string, number>;
  dictionary: string[];
  tilesLeft: number;
  myBalance: number;
}

export function chooseWord(ctx: WordContext, p: Params = PARAMS): string | null {
  const idx = index ?? indexFor(ctx.dictionary);
  const r = rackCounts(ctx.myRack);
  if (r.total < 2) return null;
  const long = bestWord(idx, r, 7);
  if (long) return long.word;
  const best = bestWord(idx, r);
  if (!best) return null;
  if (ctx.tilesLeft <= p.dumpLeft) return best.word;
  if (best.score >= p.playScore) return best.word;
  if (r.total >= p.holdTiles) return best.word;
  if (ctx.myBalance < p.lowCoins && best.score >= 3) return best.word;
  return null;
}
