import { initializeApp } from "firebase-admin/app";
import { onRequest, onCall } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { TWITCH_CLIENT_SECRET } from "./lib/config.js";
import { beginLogin, handleCallback } from "./lib/twitchAuth.js";
import { startOrResume, submitAnswer as submitAnswerLogic } from "./lib/quiz.js";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const authSecrets = [TWITCH_CLIENT_SECRET];

// --- Twitch OAuth (HTTP redirects) ---

export const twitchLogin = onRequest(
  { secrets: authSecrets },
  (req, res) => beginLogin(req, res)
);

export const twitchCallback = onRequest(
  { secrets: authSecrets },
  (req, res) => handleCallback(req, res)
);

// --- Quiz gameplay (callable; requires a signed-in Firebase user) ---

export const startQuiz = onCall(async (req) => startOrResume(req.auth));

export const submitAnswer = onCall(async (req) =>
  submitAnswerLogic(req.auth, {
    index: req.data?.index,
    choiceIndex: req.data?.choiceIndex ?? null,
  })
);
