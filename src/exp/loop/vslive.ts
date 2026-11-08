// Loop benchmark: each candidate plays a table against 5 copies of the LIVE
// config, so only real improvements over what's running show up.
// Even with live = 16.7% wins, place 3.5.
//   npx tsx src/exp/loop/vslive.ts <matches> <seed> '<json [[label, {params?, snipe?}], ...]>'
import { bench, v2Player, type Player } from "../../sim.js";
import { decideBid, PARAMS, type Params } from "../../strategy_v2.js";

export const LIVE: Params = { ...PARAMS, deltaW: 0.3, baseW: 1, pace: 1.2, playScore: 20 };
const RAW: Params = { ...PARAMS, deltaW: 1, baseW: 0, pace: 1, paceMin: 1, paceMax: 1 };

interface Snipe { delta: number; mult: number; add: number; cap: number; minLeft: number }

function candidate(name: string, p: Params, s?: Snipe): Player {
  const base = v2Player(name, p);
  if (!s) return base;
  return {
    name,
    bid: (v, l, rand) => {
      const b = base.bid(v, l, rand);
      const ctx = { letter: l, myBalance: 1e9, myRack: v.rack, tilesLeft: v.tilesLeft };
      const delta = decideBid(ctx, RAW); // raw best-word gain from this letter
      if (delta >= s.delta && v.tilesLeft >= s.minLeft) {
        return Math.max(b, Math.min(Math.round(b * s.mult + s.add), Math.floor(v.balance * s.cap)));
      }
      return b;
    },
    play: base.play,
  };
}

const matches = Number(process.argv[2] ?? 60);
const seed = Number(process.argv[3] ?? 31);
const configs: [string, { params?: Partial<Params>; snipe?: Snipe }][] = JSON.parse(process.argv[4] ?? "[]");
const live = () => v2Player("live", LIVE);
for (const [label, c] of configs) {
  const t = Date.now();
  const p = { ...LIVE, ...(c.params ?? {}) };
  const lineup = [() => candidate(label, p, c.snipe), live, live, live, live, live];
  const r = bench(lineup, matches, seed)[0]!;
  console.log(`${label.padEnd(16)} avg ${r.avg.toFixed(1).padStart(6)}  win ${r.win.toFixed(0).padStart(3)}%  place ${r.place.toFixed(2)}  ${((Date.now() - t) / 1000).toFixed(0)}s`);
}
