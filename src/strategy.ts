// Edit this file to implement your bidding and word-forming strategy.

// Standard Scrabble letter values — useful for valuation.
export const LETTER_VALUE: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

// How easy a letter is to fit into long words.
const USEFULNESS: Record<string, number> = {
  E: 1.6, A: 1.5, I: 1.4, O: 1.3, U: 0.8,
  S: 1.6, R: 1.5, T: 1.5, N: 1.4, L: 1.3, D: 1.2, C: 1.1, M: 1.1, P: 1.1,
  H: 1.1, G: 1.0, B: 1.0, Y: 1.0, F: 0.9, W: 0.9, X: 0.9, K: 0.8, Z: 0.8,
  V: 0.6, J: 0.5, Q: 0.3,
};
const VOWELS = new Set(["A", "E", "I", "O", "U"]);

function multiplier(len: number): number {
  if (len <= 3) return 1;
  if (len === 4) return 1.5;
  if (len === 5) return 2;
  if (len === 6) return 2.5;
  return 3;
}

export function wordScore(word: string): number {
  let base = 0;
  for (const c of word) base += LETTER_VALUE[c] ?? 0;
  return Math.floor(base * multiplier(word.length));
}

export interface BidContext {
  letter: string;        // Letter being auctioned, e.g. "Q"
  myBalance: number;     // Current balance
  myRack: Map<string, number>; // Letters you currently own, letter -> count
  tilesLeft: number;     // Estimated tiles still in the bag
}

/**
 * Coins only buy tiles and are worthless once the bag is empty, so spend them.
 * The auction is second-price, so bidding what a tile is worth is safe: we
 * usually pay much less.
 */
export function decideBid(ctx: BidContext): number {
  const c = ctx.letter;
  let tiles = 0;
  let vowels = 0;
  for (const [l, n] of ctx.myRack) {
    tiles += n;
    if (VOWELS.has(l)) vowels += n;
  }
  const have = ctx.myRack.get(c) ?? 0;

  let worth = (USEFULNESS[c] ?? 1) * (3 + (LETTER_VALUE[c] ?? 1));

  // Keep a playable vowel/consonant mix.
  const vowelShare = tiles > 0 ? vowels / tiles : 0.4;
  if (VOWELS.has(c)) {
    if (vowelShare < 0.3) worth *= 1.5;
    else if (vowelShare > 0.55) worth *= 0.5;
  } else if (vowelShare > 0.55) {
    worth *= 1.3;
  }
  // Third copies rarely help, except the easy ones.
  if (have >= 2 && c !== "E" && c !== "S") worth *= 0.4;
  if (c === "Q" && (ctx.myRack.get("U") ?? 0) === 0) worth *= 0.3;

  // Spend faster as the bag runs down; coins left at the end are wasted.
  const left = Math.max(1, ctx.tilesLeft);
  // 1.2 won 48% vs 18% for 0.8 against a field of the old bot (40 sims).
  const pace = Math.min(4, Math.max(0.5, (ctx.myBalance / left) * 1.2));
  const bid = Math.round(worth * pace);
  return Math.max(0, Math.min(bid, ctx.myBalance));
}

export interface WordContext {
  myRack: Map<string, number>;
  dictionary: string[]; // Sorted uppercase list, shared at startup
  tilesLeft: number;    // Estimated tiles still in the bag
  myBalance: number;
}

/**
 * Hold letters to build 7+ letter words (3x), but cash in when the rack gets
 * big, when coins run low, and always before the bag empties.
 */
export function chooseWord(ctx: WordContext): string | null {
  let tiles = 0;
  for (const count of ctx.myRack.values()) tiles += count;
  if (tiles < 2) return null;

  let best: string | null = null;
  let bestScore = 0;
  let bestLong: string | null = null;
  let bestLongScore = 0;
  for (const word of ctx.dictionary) {
    if (word.length > tiles || !canSpell(word, ctx.myRack)) continue;
    const s = wordScore(word);
    if (s > bestScore) {
      best = word;
      bestScore = s;
    }
    if (word.length >= 7 && s > bestLongScore) {
      bestLong = word;
      bestLongScore = s;
    }
  }

  if (bestLong) return bestLong;
  if (!best) return null;
  if (ctx.tilesLeft <= 15) return best;           // dump before the match ends
  if (bestScore >= 12) return best;               // a good 5-6 letter word now beats waiting
  if (tiles >= 10) return best;                   // rack too big to hold
  if (ctx.myBalance < 15 && bestScore >= 3) return best; // need coins to bid
  return null;
}

// Whether `rack` has every letter of `word`, counting repeats.
function canSpell(word: string, rack: Map<string, number>): boolean {
  const used: Record<string, number> = {};
  for (const c of word) {
    used[c] = (used[c] ?? 0) + 1;
    if (used[c] > (rack.get(c) ?? 0)) return false;
  }
  return true;
}
