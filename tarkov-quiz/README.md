# Tarkov Quiz

A timed, competitive multiple-choice quiz for an Escape from Tarkov giveaway.
Players sign in with Twitch, get **7 seconds per question**, and the highest
score lands on a live leaderboard. Built to be genuinely hard to cheat.

## Why it's built this way (security)

The whole point is that a player can't Google answers, can't read the answer
key, and can't fake a score. So:

- **Correct answers never reach the browser.** Questions live in Firestore,
  readable *only* by Cloud Functions. The client receives the prompt and the
  options — never which one is right.
- **The 7-second timer is server-authoritative.** The server stamps when it
  serves each question and rejects (scores as 0) any answer that arrives late.
  The on-screen countdown is cosmetic. Reloading the page doesn't reset the
  clock — you only get back the time that was left.
- **Options and question order are shuffled per player**, server-side, so
  "the answer is B" or "question 3 is X" can't be shared.
- **After answering, the server returns only right/wrong** — never the correct
  option — so nobody can burn a run to build an answer key.
- **One attempt per Twitch account**, enforced server-side.
- **Clients can't read questions or write scores** — Firestore rules deny it.
  Everything sensitive goes through Cloud Functions.

## Architecture

```
Browser (React + Vite)
  │  "Sign in with Twitch" ──────────────► twitchLogin  (Cloud Function)
  │                                              │  OAuth redirect
  │  ◄─── Firebase custom token in URL ─── twitchCallback (Cloud Function)
  │
  │  startQuiz / submitAnswer (callable) ─► Cloud Functions ─► Firestore
  │                                                            (questions, attempts)
  └─ reads leaderboard directly (public, read-only)
```

- `functions/` — Twitch OAuth + all quiz logic (timing, scoring, shuffling).
- `web/` — the player-facing React app.
- `seed/` — one-time script to upload your questions into Firestore.

## Prerequisites

- Node.js 20+
- A Firebase project on the **Blaze (pay-as-you-go)** plan — Cloud Functions
  require it. A giveaway for a friend sits comfortably inside the free
  allowance; you're extremely unlikely to be billed.
- The Firebase CLI: `npm install -g firebase-tools` then `firebase login`.
- A Twitch application (free) from https://dev.twitch.tv/console/apps.

---

## Setup

### 1. Create the Firebase project

1. Create a project at https://console.firebase.google.com and upgrade it to
   the **Blaze** plan.
2. Enable **Authentication** → Sign-in method → **Anonymous is not needed**;
   custom-token sign-in works without enabling a provider. (No provider toggle
   is required for custom tokens.)
3. Enable **Firestore** (production mode) and **Storage** (for image questions).
4. `cp .firebaserc.example .firebaserc` and set your project id.

### 2. Create the Twitch application

At https://dev.twitch.tv/console/apps → Register Your Application:

- **OAuth Redirect URLs:** the deployed `twitchCallback` URL, which will be:
  `https://<region>-<project-id>.cloudfunctions.net/twitchCallback`
  (region defaults to `us-central1`). You can register it now and deploy after.
- **Category:** Website Integration.
- Copy the **Client ID** and generate a **Client Secret**.

### 3. Configure the functions

```bash
cd functions
cp .env.example .env          # fill in TWITCH_CLIENT_ID, WEB_APP_URL, OAUTH_REDIRECT_URI
npm install
# Store the secret (never goes in source or .env):
firebase functions:secrets:set TWITCH_CLIENT_SECRET
```

`WEB_APP_URL` is where the app is hosted (e.g.
`https://<project>.web.app`). `OAUTH_REDIRECT_URI` must **exactly** match the
Twitch redirect URL above.

### 4. Deploy rules + functions

From the `tarkov-quiz/` root:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

> Enable Firestore TTL on the `oauthStates` collection's `expireAt` field
> (Firestore → TTL) so expired login states auto-delete. Optional but tidy.

### 5. Add your questions

Edit your questions, then upload them with the Admin SDK (bypasses rules):

```bash
cd seed
cp questions.example.json questions.json    # write your 10–20 questions here
# Get a service account key: Firebase console → Project settings →
#   Service accounts → Generate new private key
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json
npm install && npm run seed
```

**Question format** (`questions.json`):

```json
{
  "n": 1,
  "type": "text",
  "prompt": "Which ammo has the highest base penetration?",
  "options": ["7.62x39 BP", "5.45x39 BS", "5.56x45 M995", "9x19 PST gzh"],
  "correctIndex": 2
}
```

- `type`: `"text"` or `"image"`.
- For `"image"`, add `"imageUrl"`. Upload images to Storage under
  `question-images/` (they're public-read) and use their download URL, or any
  public URL.
- `correctIndex` is 0-based **in the order you list the options** — the server
  re-shuffles them per player, so the position you write here is just the key.
- Re-running `npm run seed` overwrites the collection to match the file.

### 6. Configure + deploy the web app

```bash
cd web
cp .env.example .env.local     # fill in from Firebase console → Project settings → Your apps (Web)
npm install
npm run build
cd ..
firebase deploy --only hosting
```

Set `VITE_TWITCH_LOGIN_URL` to your deployed `twitchLogin` function URL.

---

## Local development

```bash
# Terminal 1 — Firebase emulators (functions + firestore + auth)
firebase emulators:start

# Terminal 2 — web app with hot reload
cd web && npm run dev
```

Note: real Twitch OAuth redirects to the deployed callback, so for full
end-to-end login testing it's easiest to test against the deployed functions.

## Tunables

Gameplay knobs live in `functions/lib/config.js`:

- `windowMs` — time per question (default 7000).
- `networkGraceMs` — server slack for latency (default 1500).
- `basePoints` / `maxSpeedBonus` — scoring. Speed bonus scales with time left,
  so knowing the answer *fast* wins ties.

## Anti-Google tips (question design)

The 7s timer does most of the work, but design matters more than tech:

- Favor **image/screenshot** questions ("which map is this corner from?").
- Ask **relational/what-beats-what** questions over single lookup-able facts.
- Keep prompts short enough to read inside the timer.

## Picking a winner

The leaderboard is ordered by score, ties broken by finish time. Read the raw
data anytime in the Firebase console under the `leaderboard` collection
(`displayName`, `twitchLogin`, `score`, `finishedAt`).
