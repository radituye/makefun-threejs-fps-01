// Economy: money between rounds and the buy phase. One place owns the
// round clock, the phase and both teams' round wins; main.js drives the
// transitions, bots and the HUD only read this state.
export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

export function createEconomy() {
  const state = {
    phase: 'buy', // buy | live | over
    phaseTime: BUY_SECONDS, // seconds left in the current phase
    round: 1,
    wins: 0, // attacker (player) rounds won
    losses: 0, // defender rounds won
    money: 800,
    lossStreak: 0,
    lastResult: null, // 'win' | 'loss' | null, for the banner
    lastReason: '',
  };

  return {
    state,
    startBuy() {
      state.phase = 'buy';
      state.phaseTime = BUY_SECONDS;
    },
    startLive() {
      state.phase = 'live';
      state.phaseTime = ROUND_SECONDS;
    },
    step(dt) {
      if (state.phase === 'over') return null;
      state.phaseTime -= dt;
      if (state.phase === 'buy' && state.phaseTime <= 0) {
        this.startLive();
        return 'live';
      }
      if (state.phase === 'live' && state.phaseTime <= 0) {
        return 'time';
      }
      return null;
    },
    // End the round. `won` is the attacker's side. Rewards follow the
    // Counter-Strike shape: a win pays more than a loss, and a losing
    // streak pays more each time, capped at $3,400.
    endRound(won, reason) {
      state.phase = 'over';
      state.lastResult = won ? 'win' : 'loss';
      state.lastReason = reason;
      if (won) {
        state.wins += 1;
        state.money += 3250;
        state.lossStreak = 0;
      } else {
        state.losses += 1;
        state.lossStreak += 1;
        state.money += Math.min(3400, 1400 + state.lossStreak * 500);
      }
      state.money = Math.min(16000, state.money);
      return state.wins >= WIN_ROUNDS || state.losses >= WIN_ROUNDS || state.round >= MAX_ROUNDS;
    },
    nextRound() {
      state.round += 1;
      state.lastResult = null;
      state.lastReason = '';
      this.startBuy();
    },
    matchOver() {
      return state.wins >= WIN_ROUNDS || state.losses >= WIN_ROUNDS || state.round >= MAX_ROUNDS;
    },
    addKillReward() {
      state.money = Math.min(16000, state.money + 300);
    },
    spend(amount) {
      if (state.money < amount) return false;
      state.money -= amount;
      return true;
    },
  };
}
