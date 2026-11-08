# ZeroRack: ScrabbleBot tournament bot

A bot for [ScrabbleBot](https://scrabblebot.spacetimedb.com/), built on the
official `bot-starter` from [clockworklabs/scrabblebot](https://github.com/clockworklabs/scrabblebot).
The strategy is in [`src/strategy.ts`](src/strategy.ts).

## Strategy

- **Words:** hold letters for 7+ letter words (3x multiplier). Cash in early
  when coins run low or the rack reaches 12 tiles, and dump the rack when about
  10 tiles are left in the bag so nothing is wasted.
- **Bids:** coins only buy tiles and are worth nothing once the bag is empty,
  so spend them. Each letter is valued by how easily it fits into long words,
  the rack's vowel/consonant balance, and duplicates. The pace rises as the bag
  empties. The auction is second-price, so the winner pays the runner-up's bid.

## Run

Place this folder as `bot-starter/` inside a checkout of
`clockworklabs/scrabblebot` (it reads `../spacetimedb/wordlist.txt`), then:

```bash
npm install
BOT_NAME=ZeroRack BOT_TOKEN=<token from /team> TOURNAMENT_ID=2 npm start
```
