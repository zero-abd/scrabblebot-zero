// Offline benchmark: plays full matches under the module's rules (98-tile bag,
// 5-tile racks, 100 coins, second-price auctions, unsold tiles back in the bag,
// match ends when the bag empties) and reports each strategy's results.
//
//   npx tsx src/sim.ts [matches] [seed]
import * as fs from "node:fs";
import { bestWord, indexFor, rackCounts, scoreOf } from "./wordindex.js";
import * as v1 from "./strategy_v1.js";
import * as v2 from "./strategy_v2.js";

const DICT = fs
  .readFileSync(new URL("../../spacetimedb/wordlist.txt", import.meta.url), "utf8")
  .split("\n").map((l) => l.trim().toUpperCase()).filter((l) => l.length >= 2)
  .sort((a, b) => b.length - a.length);
const IDX = indexFor(DICT);
v2.setDictionary(DICT);

const BAG: [string, number][] = [
  ["A", 9], ["B", 2], ["C", 2], ["D", 4], ["E", 12], ["F", 2], ["G", 3], ["H", 2],
  ["I", 9], ["J", 1], ["K", 1], ["L", 4], ["M", 2], ["N", 6], ["O", 8], ["P", 2],
  ["Q", 1], ["R", 6], ["S", 4], ["T", 6], ["U", 4], ["V", 2], ["W", 2], ["X", 1],
  ["Y", 2], ["Z", 1],
];
const VALUE = v1.LETTER_VALUE;

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Seat { rack: Map<string, number>; balance: number; score: number }
interface View { rack: Map<string, number>; balance: number; tilesLeft: number }
export interface Player {
  name: string;
  bid(v: View, letter: string, rand: () => number): number;
  // Words to play right now (called after every auction).
  play(v: View, wonLast: boolean): string | null;
}

const longest = (rack: Map<string, number>, minLen: number) => {
  const r = rackCounts(rack);
  let best: string | null = null;
  for (const e of IDX.byScore) {
    if (e.len >= minLen && (best === null || e.len > best.length) && e.len <= r.total) {
      if ((e.mask & ~r.mask) === 0) {
        let ok = true;
        for (let s = 0; s < 26 && ok; s++) if (e.counts[s]! > r.counts[s]!) ok = false;
        if (ok) best = e.word;
      }
    }
  }
  return best;
};

// The module's simulated bots: fixed bid rule, play the longest word (3+)
// right after winning an auction.
const simBot = (name: string, base: (v: number, vowel: boolean) => number): Player => ({
  name,
  bid: (v, l, rand) => {
    const j = Math.floor(rand() * 5) - 2;
    return Math.max(0, Math.min(Math.max(base(VALUE[l] ?? 1, "AEIOU".includes(l)) + j, 1), v.balance));
  },
  play: (v, won) => (won ? longest(v.rack, 3) : null),
});

export const PLAYERS: Record<string, () => Player> = {
  cheapskate: () => simBot("cheapskate", (v) => v - 1),
  value: () => simBot("value", (v) => v),
  aggressive: () => simBot("aggressive", (v, vowel) => v + (vowel ? 4 : 2)),
  starter: () => ({
    name: "starter",
    bid: (v, l) => Math.min((v.rack.get(l) ?? 0) === 0 ? (VALUE[l] ?? 1) + 2 : Math.max(1, VALUE[l] ?? 1), v.balance),
    play: (v) => longest(v.rack, 2),
  }),
  v1: () => ({
    name: "v1",
    bid: (v, l) => v1.decideBid({ letter: l, myBalance: v.balance, myRack: v.rack, tilesLeft: v.tilesLeft }),
    play: (v) => {
      // v1's rules, using the fast index (same choices as the live scan).
      const r = rackCounts(v.rack);
      if (r.total < 2) return null;
      const long = bestWord(IDX, r, 7);
      if (long) return long.word;
      const best = bestWord(IDX, r);
      if (!best) return null;
      if (v.tilesLeft <= 15 || best.score >= 12 || r.total >= 10 || (v.balance < 15 && best.score >= 3)) return best.word;
      return null;
    },
  }),
  v2: () => v2Player("v2", v2.PARAMS),
};

export function v2Player(name: string, p: v2.Params): Player {
  return {
    name,
    bid: (v, l) => v2.decideBid({ letter: l, myBalance: v.balance, myRack: v.rack, tilesLeft: v.tilesLeft }, p),
    play: (v) => v2.chooseWord({ myRack: v.rack, dictionary: DICT, tilesLeft: v.tilesLeft, myBalance: v.balance }, p),
  };
}

function canPlay(rack: Map<string, number>, word: string) {
  const need = new Map<string, number>();
  for (const c of word) need.set(c, (need.get(c) ?? 0) + 1);
  for (const [c, n] of need) if ((rack.get(c) ?? 0) < n) return false;
  return true;
}

export function playMatch(players: Player[], rand: () => number): number[] {
  const bag: string[] = [];
  for (const [l, n] of BAG) for (let i = 0; i < n; i++) bag.push(l);
  const draw = () => bag.splice(Math.floor(rand() * bag.length), 1)[0]!;
  const seats: Seat[] = players.map(() => ({ rack: new Map(), balance: 100, score: 0 }));
  for (const s of seats) for (let i = 0; i < 5; i++) {
    const l = draw();
    s.rack.set(l, (s.rack.get(l) ?? 0) + 1);
  }
  const view = (s: Seat): View => ({ rack: s.rack, balance: s.balance, tilesLeft: bag.length });

  let guard = 0;
  while (bag.length > 0 && guard++ < 1000) {
    const letter = draw();
    const bids = players
      .map((p, i) => ({ i, amt: seats[i]!.balance > 0 ? p.bid(view(seats[i]!), letter, rand) : 0, r: rand() }))
      .filter((b) => b.amt > 0)
      .sort((a, b) => b.amt - a.amt || a.r - b.r);
    let winner = -1;
    if (bids.length === 0) {
      bag.push(letter); // unsold tiles go back in the bag
    } else {
      const paid = bids[1] ? bids[1].amt : 1;
      const s = seats[bids[0]!.i]!;
      if (s.balance >= paid) {
        s.balance -= paid;
        s.rack.set(letter, (s.rack.get(letter) ?? 0) + 1);
        winner = bids[0]!.i;
      }
    }
    if (bag.length === 0) break; // the match ends as the bag empties
    players.forEach((p, i) => {
      const s = seats[i]!;
      for (let k = 0; k < 4; k++) {
        const w = p.play(view(s), i === winner);
        if (!w || !canPlay(s.rack, w)) break;
        for (const c of w) {
          const n = s.rack.get(c)! - 1;
          if (n === 0) s.rack.delete(c); else s.rack.set(c, n);
        }
        const pts = scoreOf(w);
        s.score += pts;
        s.balance += pts;
      }
    });
  }
  return seats.map((s) => s.score);
}

export function bench(lineup: (() => Player)[], matches: number, seed: number) {
  const rand = rng(seed);
  const stats = lineup.map(() => ({ name: "", total: 0, wins: 0, place: 0 }));
  for (let m = 0; m < matches; m++) {
    // Rotate seats so seat order can't favour anyone.
    const order = lineup.map((_, i) => (i + m) % lineup.length);
    const players = order.map((i) => lineup[i]!());
    const scores = playMatch(players, rand);
    const sorted = [...scores].sort((a, b) => b - a);
    order.forEach((li, seat) => {
      const st = stats[li]!;
      st.name = players[seat]!.name;
      st.total += scores[seat]!;
      st.place += sorted.indexOf(scores[seat]!) + 1;
      if (scores[seat] === sorted[0]) st.wins++;
    });
  }
  return stats.map((s) => ({ name: s.name, avg: s.total / matches, win: (100 * s.wins) / matches, place: s.place / matches }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const matches = Number(process.argv[2] ?? 200);
  const seed = Number(process.argv[3] ?? 1);
  const t = Date.now();
  const lineup = ["v2", "v1", "starter", "cheapskate", "value", "aggressive"].map((n) => PLAYERS[n]!);
  const res = bench(lineup, matches, seed).sort((a, b) => b.avg - a.avg);
  console.log(`${matches} matches in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  for (const r of res) console.log(`${r.name.padEnd(11)} avg ${r.avg.toFixed(1).padStart(6)}  win ${r.win.toFixed(0).padStart(3)}%  place ${r.place.toFixed(2)}`);
}
