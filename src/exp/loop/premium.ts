// Does paying more for premium letters help against the realistic field?
// Real data: top bots pay ~25.8 per J/Q/X/Z and ~15.5 per 3-5 point letter;
// ZeroRack paid 12.7 and 9.0.
//   npx tsx src/exp/loop/premium.ts <matches> <seed> <label,label,...>
import { bench, v2Player, type Player } from "../../sim.js";
import { PARAMS, type Params } from "../../strategy_v2.js";
import { FIELD } from "../realfield/field.js";
import { LETTER_VALUE } from "../../strategy_v2.js";

const LIVE: Params = { ...PARAMS, deltaW: 0.3, baseW: 1, pace: 1.2, playScore: 32 };
const VOWELS = new Set(["A", "E", "I", "O", "U"]);

interface Mult { vowel: number; mid: number; high: number }

function premium(name: string, p: Params, m: Mult): Player {
  const base = v2Player(name, p);
  return {
    name,
    bid: (v, l, rand) => {
      const b = base.bid(v, l, rand);
      const val = LETTER_VALUE[l] ?? 1;
      let k = 1;
      if (VOWELS.has(l)) k = m.vowel;
      else if (val >= 8) k = l === "Q" && (v.rack.get("U") ?? 0) === 0 ? 1 : m.high;
      else if (val >= 3) k = m.mid;
      return Math.max(0, Math.min(Math.round(b * k), v.balance));
    },
    play: base.play,
  };
}

const CANDS: Record<string, () => Player> = {
  live: () => v2Player("live", LIVE),
  premA: () => premium("premA", LIVE, { vowel: 0.9, mid: 1.5, high: 2.0 }),
  premB: () => premium("premB", LIVE, { vowel: 1, mid: 1.3, high: 1.6 }),
  premA_dump10: () => premium("premA_dump10", { ...LIVE, dumpLeft: 10 }, { vowel: 0.9, mid: 1.5, high: 2.0 }),
};

const matches = Number(process.argv[2] ?? 60);
const seed = Number(process.argv[3] ?? 1);
const labels = (process.argv[4] ?? Object.keys(CANDS).join(",")).split(",");
const table = ["s7a", "s7a", "six", "mid", "weak"].map((k) => FIELD[k]!);
for (const label of labels) {
  const t = Date.now();
  const r = bench([CANDS[label]!, ...table], matches, seed)[0]!;
  console.log(`seed ${seed} ${label.padEnd(13)} avg ${r.avg.toFixed(1).padStart(6)}  win ${r.win.toFixed(0).padStart(3)}%  place ${r.place.toFixed(2)}  ${((Date.now() - t) / 1000).toFixed(0)}s`);
}
