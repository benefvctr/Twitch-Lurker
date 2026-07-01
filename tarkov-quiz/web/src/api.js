import { httpsCallable } from "firebase/functions";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit as fbLimit,
} from "firebase/firestore";
import { functions, db } from "./firebase.js";

const _startQuiz = httpsCallable(functions, "startQuiz");
const _submitAnswer = httpsCallable(functions, "submitAnswer");

export async function startQuiz() {
  const res = await _startQuiz();
  return res.data;
}

export async function submitAnswer(index, choiceIndex) {
  const res = await _submitAnswer({ index, choiceIndex });
  return res.data;
}

// Live leaderboard subscription. `cb` receives an array of { displayName, score }.
export function subscribeLeaderboard(cb, max = 25) {
  const q = query(
    collection(db, "leaderboard"),
    orderBy("score", "desc"),
    orderBy("finishedAt", "asc"),
    fbLimit(max)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
