import crypto from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  OAUTH_REDIRECT_URI,
  WEB_APP_URL,
} from "./config.js";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the round trip

// Build the Twitch authorize URL and stash a one-time CSRF `state` in Firestore.
export async function beginLogin(req, res) {
  const db = getFirestore();
  const state = crypto.randomBytes(24).toString("hex");

  await db.collection("oauthStates").doc(state).set({
    createdAt: FieldValue.serverTimestamp(),
    // Firestore TTL policy on `expireAt` will garbage-collect stale states.
    expireAt: new Date(Date.now() + STATE_TTL_MS),
  });

  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID.value(),
    redirect_uri: OAUTH_REDIRECT_URI.value(),
    response_type: "code",
    scope: "", // we only need identity; no extra scopes required
    state,
    force_verify: "true",
  });

  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params.toString()}`);
}

// Handle Twitch's redirect back: validate state, exchange code, fetch the user,
// mint a Firebase custom token, and bounce the browser back to the web app.
export async function handleCallback(req, res) {
  const db = getFirestore();
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return redirectWithError(res, errorDescription || error);
  }
  if (!code || !state) {
    return redirectWithError(res, "Missing code or state.");
  }

  // Validate + consume the one-time state (CSRF protection).
  const stateRef = db.collection("oauthStates").doc(String(state));
  const stateSnap = await stateRef.get();
  if (!stateSnap.exists) {
    return redirectWithError(res, "Invalid or expired login. Please try again.");
  }
  const createdAtMs = stateSnap.get("createdAt")?.toMillis?.() ?? 0;
  await stateRef.delete();
  if (Date.now() - createdAtMs > STATE_TTL_MS) {
    return redirectWithError(res, "Login expired. Please try again.");
  }

  // Exchange the authorization code for an access token.
  const tokenResp = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID.value(),
      client_secret: TWITCH_CLIENT_SECRET.value(),
      code: String(code),
      grant_type: "authorization_code",
      redirect_uri: OAUTH_REDIRECT_URI.value(),
    }),
  });
  if (!tokenResp.ok) {
    return redirectWithError(res, "Twitch token exchange failed.");
  }
  const { access_token: accessToken } = await tokenResp.json();

  // Fetch the Twitch user's identity.
  const userResp = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": TWITCH_CLIENT_ID.value(),
    },
  });
  if (!userResp.ok) {
    return redirectWithError(res, "Failed to read Twitch profile.");
  }
  const userJson = await userResp.json();
  const user = userJson?.data?.[0];
  if (!user?.id) {
    return redirectWithError(res, "No Twitch user returned.");
  }

  // Mint a Firebase custom token keyed by the Twitch user id. The `twitch:`
  // prefix keeps these uids from ever colliding with other auth providers.
  const uid = `twitch:${user.id}`;
  const displayName = user.display_name || user.login;
  const customToken = await getAuth().createCustomToken(uid, {
    twitchId: user.id,
    twitchLogin: user.login,
    displayName,
  });

  // Hand the token back via URL fragment (never logged by servers/proxies).
  const redirectUrl = new URL(WEB_APP_URL.value());
  redirectUrl.hash = new URLSearchParams({
    token: customToken,
    name: displayName,
  }).toString();
  res.redirect(redirectUrl.toString());
}

function redirectWithError(res, message) {
  const url = new URL(WEB_APP_URL.value());
  url.hash = new URLSearchParams({ authError: message }).toString();
  res.redirect(url.toString());
}
