// Central config + tunables. Secrets come from Firebase params/secrets, not source.
import { defineString, defineSecret } from "firebase-functions/params";

// --- Secrets (set with: firebase functions:secrets:set TWITCH_CLIENT_SECRET) ---
export const TWITCH_CLIENT_SECRET = defineSecret("TWITCH_CLIENT_SECRET");

// --- Params (set in functions/.env or .env.<project>) ---
export const TWITCH_CLIENT_ID = defineString("TWITCH_CLIENT_ID");
// Where the browser app lives, e.g. https://tarkov-quiz.web.app
export const WEB_APP_URL = defineString("WEB_APP_URL");
// The deployed URL of the twitchCallback function (Twitch redirect URI).
// e.g. https://us-central1-<project>.cloudfunctions.net/twitchCallback
export const OAUTH_REDIRECT_URI = defineString("OAUTH_REDIRECT_URI");

// --- Gameplay tunables ---
export const QUIZ = {
  // Per-question answer window shown to the player.
  windowMs: 7000,
  // Extra slack the SERVER allows on top of windowMs to absorb network latency,
  // so an honest player near the buzzer isn't unfairly timed out. Keep small.
  networkGraceMs: 1500,
  // Points for a correct in-time answer, before speed bonus.
  basePoints: 1000,
  // Max additional points, scaled linearly by how much time was left.
  maxSpeedBonus: 500,
};
