import { QUIZ } from "./config.js";

// All scoring happens on the server from the server's own clock.
//
// elapsedMs  = serverNow - questionServedAt  (how long the player actually took)
// choiceIdx  = the player's chosen option index in the SHUFFLED order, or null
// correctIdx = the correct option index in that same shuffled order
//
// Returns { correct, timedOut, pointsAwarded }.
export function scoreAnswer({ elapsedMs, choiceIdx, correctIdx }) {
  const hardLimit = QUIZ.windowMs + QUIZ.networkGraceMs;
  const timedOut = choiceIdx === null || choiceIdx === undefined || elapsedMs > hardLimit;

  if (timedOut) {
    return { correct: false, timedOut: true, pointsAwarded: 0 };
  }

  const correct = choiceIdx === correctIdx;
  if (!correct) {
    return { correct: false, timedOut: false, pointsAwarded: 0 };
  }

  // Speed bonus scales with time remaining against the DISPLAYED window (not the
  // grace-padded hard limit), clamped to [0, windowMs].
  const timeLeft = Math.max(0, Math.min(QUIZ.windowMs, QUIZ.windowMs - elapsedMs));
  const speedBonus = Math.round((timeLeft / QUIZ.windowMs) * QUIZ.maxSpeedBonus);
  return { correct: true, timedOut: false, pointsAwarded: QUIZ.basePoints + speedBonus };
}
