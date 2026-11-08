// ScrabbleBot bot starter.
//
// First run, with a token from the website:
//   On your team's page, click "Generate token", then run
//   `BOT_NAME=<name> BOT_TOKEN=<token> npm start`.
//
// Or with a nonce from the CLI:
//   1. `spacetime call scrabblebot mint_credential_nonce`
//      `spacetime sql 'SELECT code FROM my_nonces ORDER BY expires_at DESC'`
//   2. `BOT_NAME=<name> BOT_NONCE=<code> npm start`
//      The bot connects fresh and redeems the nonce.
//
// Either way the bot saves its token to .token-<BOT_NAME>, so later runs
// need only `BOT_NAME=<name> npm start`.
//
// Entering a tournament: `BOT_NAME=<name> TOURNAMENT_ID=<id> npm start`
// registers the bot for that tournament when it connects. Only the bot
// itself can register, so this has to come from the bot's process.
//
// Edit ./src/strategy.ts to customise how your bot bids and plays words.

import {
  DbConnection,
  type EventContext,
  type ErrorContext,
} from "./module_bindings/index.js";
import { Identity } from "spacetimedb";
import * as fs from "node:fs";
import * as path from "node:path";
import { PARAMS, chooseWord, decideBid, setDictionary } from "./strategy_v2.js";

// Best config from the offline benchmarks. playScore 32 beat the previous live
// config (playScore 20) head-to-head: 35% wins vs 20%, 60 simulated matches.
Object.assign(PARAMS, { deltaW: 0.3, baseW: 1, pace: 1.2, playScore: 32 });

const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const DB_NAME = process.env.STDB_DB ?? "scrabblebot";
const BOT_NAME = process.env.BOT_NAME ?? "bot";
const BOT_TOKEN = process.env.BOT_TOKEN; // from the website, first run only
const BOT_NONCE = process.env.BOT_NONCE; // from the CLI, first run only
const TOURNAMENT_ID = process.env.TOURNAMENT_ID;
const BOT_ID = Number(process.env.BOT_ID ?? 394); // ZeroRack's bot id on the site
const TOKEN_PATH = path.join(process.cwd(), `.token-${BOT_NAME}`);

function loadToken(): string | undefined {
  try {
    return fs.readFileSync(TOKEN_PATH, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}
function saveToken(tok: string) {
  fs.writeFileSync(TOKEN_PATH, tok);
}

// Load the shared wordlist so the bot can pick playable words locally.
const dictionaryPath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "spacetimedb",
  "wordlist.txt",
);
const DICTIONARY: string[] = fs.existsSync(dictionaryPath)
  ? fs
      .readFileSync(dictionaryPath, "utf8")
      .split("\n")
      .map((l) => l.trim().toUpperCase())
      .filter((l) => l.length >= 2)
  : [];
DICTIONARY.sort((a, b) => b.length - a.length); // longest first for greedy pick
setDictionary(DICTIONARY);

let myIdentity: Identity | null = null;
let myBotId: bigint | null = null;
const bidsByAuction = new Set<string>();
// AUDIT PATCH (fix 1): the old 500 ms throttle was stamped by every 300 ms
// timer tick, even ticks that played nothing, so a rack change usually landed
// inside the throttle and waited for a later tick. Live data: ZeroRack's words
// land a median 537 ms after the close that gave it the tile (other bots: 114).
// Instead, allow one submitWord in flight per match; the next attempt runs as
// soon as the server answers, so the rack is never stale and dumps chain at RTT.
const wordInFlight = new Set<string>();
let wordTimer: NodeJS.Timeout | null = null;

function resolveMyBotId(conn: DbConnection): bigint | null {
  if (!myIdentity) return null;
  const cred = conn.db.botCredential.identity.find(myIdentity);
  return cred ? cred.botId : null;
}

function rackForMatch(
  conn: DbConnection,
  matchId: bigint,
): Map<string, number> {
  const rack = new Map<string, number>();
  for (const h of conn.db.myRack.iter()) {
    if (h.matchId !== matchId) continue;
    rack.set(h.letter, (rack.get(h.letter) ?? 0) + h.count);
  }
  return rack;
}

// Tiles still in the bag. The module decrements bagTotal on every draw.
function tilesLeftFor(conn: DbConnection, matchId: bigint): number {
  const m = conn.db.matchState.id.find(matchId);
  return m ? m.bagTotal : 100;
}

function participantForMatch(
  conn: DbConnection,
  matchId: bigint,
): { balance: number; score: number } | null {
  if (myBotId === null) return null;
  for (const p of conn.db.matchParticipant.iter()) {
    if (p.matchId !== matchId) continue;
    if (p.botId !== myBotId) continue;
    return { balance: Number(p.balance), score: Number(p.score) };
  }
  return null;
}

// A reducer call fails when the module refuses it, often for an expected
// reason: a word played just after its match ended, a bid that missed the
// auction's window. Log it and keep playing; an uncaught failure would stop
// the bot.
function logFailure(what: string) {
  return (err: unknown) =>
    console.warn(
      `[${BOT_NAME}] ${what} failed: ${err instanceof Error ? err.message : err}`,
    );
}

function tryBid(
  conn: DbConnection,
  auctionId: bigint,
  matchId: bigint,
  letter: string,
) {
  if (myBotId === null) return;
  const key = `${matchId}:${auctionId}`;
  if (bidsByAuction.has(key)) return;
  const participant = participantForMatch(conn, matchId);
  if (!participant) return;
  // AUDIT PATCH (fix 3): an auction that opens with the bag already empty is
  // the last one. Its tile is added in the same transaction that ends the
  // match, so it can never be played. ZeroRack won it in 13 of 25 matches.
  // The bot has no other use for the coin, so this changes no points; it only
  // stops the bot buying a tile it can't use.
  if (tilesLeftFor(conn, matchId) === 0) {
    bidsByAuction.add(key);
    return;
  }
  const amount = decideBid({
    letter,
    myBalance: participant.balance,
    myRack: rackForMatch(conn, matchId),
    tilesLeft: tilesLeftFor(conn, matchId),
  });
  if (amount <= 0) return;
  conn.reducers
    .submitBid({ auctionId, amount: BigInt(amount) })
    .catch(logFailure(`bid on auction ${auctionId}`));
  bidsByAuction.add(key);
  console.log(
    `[${BOT_NAME}] bid ${amount} on '${letter}' (match ${matchId}, auction ${auctionId})`,
  );
}

function tryPlayWord(conn: DbConnection) {
  if (myBotId === null) return;
  // Only matches still being played. The bot keeps its letters from
  // matches that have ended, but can't play them.
  const matches = new Set<bigint>();
  for (const p of conn.db.matchParticipant.iter()) {
    if (p.botId !== myBotId) continue;
    const m = conn.db.matchState.id.find(p.matchId);
    if (m?.status.tag === "Running") matches.add(p.matchId);
  }
  for (const matchId of matches) {
    const key = String(matchId);
    if (wordInFlight.has(key)) continue; // answer pending; rack may be stale
    const word = chooseWord({
      myRack: rackForMatch(conn, matchId),
      dictionary: DICTIONARY,
      tilesLeft: tilesLeftFor(conn, matchId),
      myBalance: participantForMatch(conn, matchId)?.balance ?? 0,
    });
    if (!word) continue;
    console.log(`[${BOT_NAME}] match ${matchId}: playing '${word}'`);
    wordInFlight.add(key);
    // Safety valve: never let a lost reply block word play for long.
    const valve = setTimeout(() => wordInFlight.delete(key), 1500);
    conn.reducers
      .submitWord({ matchId, word })
      .then(
        () => true,
        (err: unknown) => {
          logFailure(`playing '${word}'`)(err);
          return false;
        },
      )
      .then((ok) => {
        clearTimeout(valve);
        // After a rejection, wait 300 ms before trying again so a word the
        // server keeps refusing can't cause a retry loop.
        if (!ok) {
          setTimeout(() => wordInFlight.delete(key), 300);
          return;
        }
        wordInFlight.delete(key);
        // The rack has changed by now (or the play failed). Look again right
        // away so a second word from the same rack goes out at RTT, not on a
        // later timer tick. This matters at the end of the match, when the
        // last playable tile arrives with only about 1 s left.
        tryPlayWord(conn);
      });
  }
}

function onConnect(conn: DbConnection, identity: Identity, token: string) {
  myIdentity = identity;
  saveToken(token);
  console.log(`[${BOT_NAME}] connected as ${identity.toHexString()}`);

  conn
    .subscriptionBuilder()
    .onApplied(() => {
      console.log(`[${BOT_NAME}] subscription applied`);

      // Resolve our bot id, possibly after claiming a nonce.
      myBotId = resolveMyBotId(conn);
      if (myBotId === null) {
        if (BOT_NONCE) {
          console.log(`[${BOT_NAME}] claiming credential with nonce…`);
          conn.reducers
            .claimCredential({ code: BOT_NONCE })
            .catch(logFailure("claiming the credential"));
          // Wait briefly for the credential to land; check again.
          setTimeout(() => {
            myBotId = resolveMyBotId(conn);
            if (myBotId === null) {
              console.error(
                `[${BOT_NAME}] couldn't claim credential. Bad / expired nonce?`,
              );
              process.exit(1);
            }
            const bot = conn.db.bot.id.find(myBotId);
            console.log(
              `[${BOT_NAME}] claimed credential for bot '${bot?.name ?? "?"}' (id ${myBotId})`,
            );
            bootstrapActivity(conn);
          }, 1000);
          return;
        } else {
          console.error(
            `[${BOT_NAME}] no BotCredential for this token. Set BOT_TOKEN or BOT_NONCE and re-run.`,
          );
          process.exit(1);
        }
      }

      const bot = conn.db.bot.id.find(myBotId);
      console.log(
        `[${BOT_NAME}] acting as bot '${bot?.name ?? "?"}' (id ${myBotId})`,
      );
      bootstrapActivity(conn);
    })
    // Only this bot's own matches. Subscribing to everything pulls the full
    // history of every match and stalls Node in garbage collection.
    .subscribe([
      "SELECT * FROM bot",
      "SELECT * FROM bot_credential",
      "SELECT * FROM lobby",
      "SELECT * FROM lobby_member",
      `SELECT * FROM match_participant WHERE bot_id = ${BOT_ID}`,
      `SELECT m.* FROM match_state m JOIN match_participant p ON m.id = p.match_id WHERE p.bot_id = ${BOT_ID}`,
      `SELECT a.* FROM auction a JOIN match_participant p ON a.match_id = p.match_id WHERE p.bot_id = ${BOT_ID}`,
      "SELECT * FROM my_rack",
    ]);

  conn.db.auction.onInsert((_ctx: EventContext, a) => {
    if (a.status.tag === "Open") tryBid(conn, a.id, a.matchId, a.letter);
  });
  conn.db.myRack.onInsert(() => tryPlayWord(conn));
  conn.db.myRack.onUpdate(() => tryPlayWord(conn));
  conn.db.myRack.onDelete(() => tryPlayWord(conn)); // AUDIT PATCH: a word that uses all of a letter deletes its row
  conn.db.botCredential.onInsert(() => {
    if (myBotId === null) myBotId = resolveMyBotId(conn);
  });
  conn.db.auctionResult.onInsert((_ctx, r) => {
    if (myBotId === null) return;
    const winner =
      r.winnerBotId !== undefined && r.winnerBotId !== null
        ? String(r.winnerBotId)
        : "no-bid";
    console.log(
      `[${BOT_NAME}] match ${r.matchId} auction ${r.auctionId} '${r.letter}' → bot ${winner} paid ${r.paid}`,
    );
  });

  // When a match this bot was in ends, hop back into the lobby.
  conn.db.matchState.onUpdate((_ctx, old, neu) => {
    if (myBotId === null) return;
    if (old.status.tag !== "Ended" && neu.status.tag === "Ended") {
      const wasIn = Array.from(conn.db.matchParticipant.iter()).some(
        (p) => p.matchId === neu.id && p.botId === myBotId,
      );
      if (wasIn) {
        console.log(`[${BOT_NAME}] match ${neu.id} ended; rejoining lobby`);
        joinLobby(conn);
      }
    }
  });
}

function joinLobby(conn: DbConnection) {
  if (myBotId === null) return;
  const inRunning = Array.from(conn.db.matchParticipant.iter()).some((p) => {
    if (p.botId !== myBotId) return false;
    const m = conn.db.matchState.id.find(p.matchId);
    return m?.status.tag === "Running";
  });
  if (inRunning) return;
  const openLobby = Array.from(conn.db.lobby.iter()).find(
    (l) => l.status.tag === "Open",
  );
  const alreadyIn =
    openLobby !== undefined &&
    Array.from(conn.db.lobbyMember.iter()).some(
      (lm) => lm.lobbyId === openLobby.id && lm.botId === myBotId,
    );
  if (alreadyIn) return;
  console.log(`[${BOT_NAME}] joining lobby`);
  conn.reducers.joinLobby({}).catch(logFailure("joining the lobby"));
}

function bootstrapActivity(conn: DbConnection) {
  if (TOURNAMENT_ID) {
    conn.reducers
      .registerForTournament({ tournamentId: BigInt(TOURNAMENT_ID) })
      .then(() =>
        console.log(`[${BOT_NAME}] registered for tournament ${TOURNAMENT_ID}`),
      )
      .catch(logFailure(`registering for tournament ${TOURNAMENT_ID}`));
  }
  joinLobby(conn);
  for (const a of conn.db.auction.iter()) {
    if (a.status.tag === "Open") tryBid(conn, a.id, a.matchId, a.letter);
  }
  tryPlayWord(conn);
  // Re-check words even when the rack doesn't change, so the bot cashes in
  // its held letters as the bag runs down.
  // The timer no longer throttles anything; it is only a backstop.
  if (wordTimer) clearInterval(wordTimer);
  wordTimer = setInterval(() => tryPlayWord(conn), 300);
}

// AUDIT PATCH (fix 2): the live bot only logs "disconnected" and then sits
// idle until someone restarts it. In match 47426 it stopped bidding at
// 04:37:53 and never bid or played again in that match: 0 points, 8 tiles and
// 64 coins unused. Reconnect with backoff. The saved token keeps the same
// identity; bootstrapActivity re-bids on the open auction and replays the rack.
let reconnectDelayMs = 500;
let reconnectPending = false;
function scheduleReconnect() {
  if (reconnectPending) return; // connectError and disconnect can both fire
  reconnectPending = true;
  if (wordTimer) {
    clearInterval(wordTimer);
    wordTimer = null;
  }
  wordInFlight.clear();
  const wait = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10_000);
  console.warn(`[${BOT_NAME}] reconnecting in ${wait} ms`);
  setTimeout(() => {
    reconnectPending = false;
    main();
  }, wait);
}

function main() {
  console.log(`[${BOT_NAME}] connecting to ${DB_NAME} at ${HOST}`);
  DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(BOT_TOKEN ?? loadToken())
    .onConnect((conn, identity, token) => {
      reconnectDelayMs = 500;
      reconnectPending = false;
      onConnect(conn, identity, token);
    })
    .onConnectError((_ctx: ErrorContext, err: Error) => {
      console.error("connect error:", err.message);
      scheduleReconnect();
    })
    .onDisconnect(() => {
      console.log("disconnected");
      scheduleReconnect();
    })
    .build();
}

main();
