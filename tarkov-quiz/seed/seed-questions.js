// Uploads your questions into Firestore using the Admin SDK (server-side, so it
// bypasses security rules — that's why questions can be locked to no client reads).
//
// Usage:
//   1. Download a service-account key from the Firebase console:
//      Project settings -> Service accounts -> Generate new private key
//   2. export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json
//   3. cp questions.example.json questions.json   (then edit in YOUR questions)
//   4. npm install && npm run seed
//
// Re-running is safe: it overwrites the questions collection to match the file.

import { readFileSync } from "node:fs";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const FILE = process.env.QUESTIONS_FILE || "questions.json";

function validate(q, i) {
  const where = `question index ${i} (n=${q.n})`;
  if (!["text", "image"].includes(q.type)) throw new Error(`${where}: type must be "text" or "image"`);
  if (typeof q.prompt !== "string" || !q.prompt.trim()) throw new Error(`${where}: missing prompt`);
  if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`${where}: need >= 2 options`);
  if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
    throw new Error(`${where}: correctIndex out of range`);
  }
  if (q.type === "image" && !q.imageUrl) throw new Error(`${where}: image questions need imageUrl`);
}

async function main() {
  const raw = readFileSync(new URL(FILE, import.meta.url));
  const questions = JSON.parse(raw);
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(`${FILE} must be a non-empty JSON array`);
  }
  questions.forEach(validate);

  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  // Clear existing questions so the collection mirrors the file exactly.
  const existing = await db.collection("questions").get();
  const wipe = db.batch();
  existing.forEach((d) => wipe.delete(d.ref));
  await wipe.commit();

  const batch = db.batch();
  questions.forEach((q, i) => {
    const ref = db.collection("questions").doc(`q${q.n ?? i + 1}`);
    batch.set(ref, {
      n: q.n ?? i + 1,
      type: q.type,
      prompt: q.prompt,
      imageUrl: q.imageUrl ?? null,
      options: q.options,
      correctIndex: q.correctIndex,
      active: q.active !== false,
    });
  });
  await batch.commit();

  console.log(`Seeded ${questions.length} questions into Firestore.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
