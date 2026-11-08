// Each candidate plays a table against 5 copies of v1 (the live bot).
// Even with v1 = 16.7% wins, place 3.5.
//   npx tsx src/sweep.ts <matches> <seed> '<json array of [label, partialParams]>'
import { bench, PLAYERS, v2Player } from "./sim.js";
import { PARAMS, type Params } from "./strategy_v2.js";

const matches = Number(process.argv[2] ?? 40);
const seed = Number(process.argv[3] ?? 7);
const configs: [string, Partial<Params>][] = JSON.parse(process.argv[4] ?? "[]");

for (const [label, partial] of configs) {
  const p: Params = { ...PARAMS, ...partial };
  const lineup = [() => v2Player(label, p), PLAYERS.v1!, PLAYERS.v1!, PLAYERS.v1!, PLAYERS.v1!, PLAYERS.v1!];
  const r = bench(lineup, matches, seed)[0]!;
  console.log(`${label.padEnd(26)} avg ${r.avg.toFixed(1).padStart(6)}  win ${r.win.toFixed(0).padStart(3)}%  place ${r.place.toFixed(2)}  ${JSON.stringify(partial)}`);
}
