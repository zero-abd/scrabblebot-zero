// Quick offline check of strategy speed and choices against the real wordlist.
import * as fs from "node:fs";
import { chooseWord, decideBid, wordScore } from "./strategy.js";

const dict = fs
  .readFileSync(new URL("../../spacetimedb/wordlist.txt", import.meta.url), "utf8")
  .split("\n")
  .map((l) => l.trim().toUpperCase())
  .filter((l) => l.length >= 2)
  .sort((a, b) => b.length - a.length);

const rack = (s: string) => {
  const m = new Map<string, number>();
  for (const c of s) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
};

for (const [r, left, bal] of [
  ["AEIRST", 40, 60], ["AEINRST", 40, 60], ["QZXAEIO", 40, 60],
  ["ETAOINS", 5, 30], ["BCDFGHE", 5, 30], ["AERT", 40, 5],
] as const) {
  const t = performance.now();
  const w = chooseWord({ myRack: rack(r), dictionary: dict, tilesLeft: left, myBalance: bal });
  console.log(`${r.padEnd(8)} left=${String(left).padStart(2)} bal=${bal} -> ${w ?? "(hold)"} ${w ? wordScore(w) : ""}  ${(performance.now() - t).toFixed(1)}ms`);
}
for (const [l, r, bal, left] of [["E", "BCDT", 100, 68], ["E", "AEIO", 100, 68], ["Q", "ABC", 100, 68], ["Z", "AEST", 100, 68], ["S", "AERT", 40, 10]] as const) {
  console.log(`bid on ${l} rack=${r} bal=${bal} left=${left}: ${decideBid({ letter: l, myRack: rack(r), myBalance: bal, tilesLeft: left })}`);
}
