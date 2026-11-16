// Ledger: funds between rounds and the shop phase. One place owns the
// round clock, the stage and both sides' round wins; main.js drives the
// transitions, the squad and the readout only read this state.
export const SHOP_SPAN = 12;
export const ROUND_SPAN = 100;
export const ROUNDS_TO_WIN = 5;
export const ROUND_CAP = 9;

export function openLedger() {
  const books = {
    stage: 'shop', // shop | live | over
    stageLeft: SHOP_SPAN, // seconds left in the current stage
    roundNo: 1,
    taken: 0, // attacker (player) rounds won
    ceded: 0, // defender rounds won
    funds: 800,
    losingRun: 0,
    lastOutcome: null, // 'win' | 'loss' | null, for the banner
    lastCause: '',
  };

  return {
    books,
    openShop() {
      books.stage = 'shop';
      books.stageLeft = SHOP_SPAN;
    },
    openRound() {
      books.stage = 'live';
      books.stageLeft = ROUND_SPAN;
    },
    tick(dt) {
      if (books.stage === 'over') return null;
      books.stageLeft -= dt;
      if (books.stage === 'shop' && books.stageLeft <= 0) {
        this.openRound();
        return 'live';
      }
      if (books.stage === 'live' && books.stageLeft <= 0) {
        return 'time';
      }
      return null;
    },
    // Settle the round. `won` is the attacker's side. Rewards follow the
    // Counter-Strike shape: a win pays more than a loss, and a losing
    // streak pays more each time, capped at $3,400.
    settleRound(won, cause) {
      books.stage = 'over';
      books.lastOutcome = won ? 'win' : 'loss';
      books.lastCause = cause;
      if (won) {
        books.taken += 1;
        books.funds += 3250;
        books.losingRun = 0;
      } else {
        books.ceded += 1;
        books.losingRun += 1;
        books.funds += Math.min(3400, 1400 + books.losingRun * 500);
      }
      books.funds = Math.min(16000, books.funds);
      return books.taken >= ROUNDS_TO_WIN || books.ceded >= ROUNDS_TO_WIN || books.roundNo >= ROUND_CAP;
    },
    advanceRound() {
      books.roundNo += 1;
      books.lastOutcome = null;
      books.lastCause = '';
      this.openShop();
    },
    matchDone() {
      return books.taken >= ROUNDS_TO_WIN || books.ceded >= ROUNDS_TO_WIN || books.roundNo >= ROUND_CAP;
    },
    payKill() {
      books.funds = Math.min(16000, books.funds + 300);
    },
    pay(amount) {
      if (books.funds < amount) return false;
      books.funds -= amount;
      return true;
    },
  };
}
