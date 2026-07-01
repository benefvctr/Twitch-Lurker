import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { QUIZ } from "./config.js";
import { shuffle } from "./shuffle.js";
import { scoreAnswer } from "./scoring.js";

// Load all active questions, ordered by their canonical `n` field.
async function loadQuestionBank(db) {
  const snap = await db.collection("questions").where("active", "==", true).get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  return items;
}

// Build a freshly-served question: shuffle its options and record where the
// correct one landed. The shuffled correct index is stored server-side only.
function serveQuestion(question) {
  const withIdx = question.options.map((text, i) => ({ text, correct: i === question.correctIndex }));
  const shuffled = shuffle(withIdx);
  return {
    inFlight: {
      questionId: question.id,
      servedAt: Timestamp.now(),
      shuffledOptions: shuffled.map((o) => o.text),
      shuffledCorrectIndex: shuffled.findIndex((o) => o.correct),
    },
    // Public payload — NO correct answer included.
    publicQuestion: {
      type: question.type,
      prompt: question.prompt,
      imageUrl: question.imageUrl ?? null,
      options: shuffled.map((o) => o.text),
    },
  };
}

function remainingMs(inFlight) {
  const elapsed = Date.now() - inFlight.servedAt.toMillis();
  return Math.max(0, QUIZ.windowMs - elapsed);
}

function identity(auth) {
  return {
    twitchId: auth.token.twitchId ?? auth.uid.replace(/^twitch:/, ""),
    twitchLogin: auth.token.twitchLogin ?? null,
    displayName: auth.token.displayName ?? auth.token.twitchLogin ?? "Anonymous",
  };
}

// Create the attempt if needed, then return the current question the player
// should see (serving a fresh one on first view, or resuming an in-flight one).
export async function startOrResume(auth) {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in with Twitch first.");
  const db = getFirestore();
  const ref = db.collection("attempts").doc(auth.uid);

  return db.runTransaction(async (tx) => {
    let snap = await tx.get(ref);

    if (!snap.exists) {
      const bank = await loadQuestionBank(db);
      if (bank.length === 0) throw new HttpsError("failed-precondition", "No questions configured.");
      const order = shuffle(bank.map((q) => q.id));
      const first = bank.find((q) => q.id === order[0]);
      const { inFlight, publicQuestion } = serveQuestion(first);
      const { twitchId, twitchLogin, displayName } = identity(auth);

      tx.set(ref, {
        uid: auth.uid,
        twitchId,
        twitchLogin,
        displayName,
        order,
        currentIndex: 0,
        inFlight,
        answers: [],
        score: 0,
        finished: false,
        startedAt: Timestamp.now(),
        finishedAt: null,
      });

      return {
        finished: false,
        index: 0,
        total: order.length,
        remainingMs: QUIZ.windowMs,
        question: publicQuestion,
      };
    }

    const data = snap.data();
    if (data.finished) {
      return { finished: true, score: data.score, total: data.order.length };
    }

    // Resume: if a question is already in flight, return whatever time is left
    // (a page refresh mid-question only gives back the leftover seconds — you
    // don't get a fresh timer by reloading).
    let inFlight = data.inFlight;
    let publicQuestion;
    if (inFlight) {
      const q = (await tx.get(db.collection("questions").doc(inFlight.questionId))).data();
      publicQuestion = {
        type: q.type,
        prompt: q.prompt,
        imageUrl: q.imageUrl ?? null,
        options: inFlight.shuffledOptions,
      };
    } else {
      const q = (await tx.get(db.collection("questions").doc(data.order[data.currentIndex]))).data();
      const served = serveQuestion({ id: data.order[data.currentIndex], ...q });
      inFlight = served.inFlight;
      publicQuestion = served.publicQuestion;
      tx.update(ref, { inFlight });
    }

    return {
      finished: false,
      index: data.currentIndex,
      total: data.order.length,
      remainingMs: remainingMs(inFlight),
      question: publicQuestion,
    };
  });
}

// Score the current answer, advance, and either serve the next question or
// finalize the attempt and write the leaderboard row.
export async function submitAnswer(auth, { index, choiceIndex }) {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in with Twitch first.");
  const db = getFirestore();
  const ref = db.collection("attempts").doc(auth.uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("failed-precondition", "No attempt in progress.");
    const data = snap.data();

    if (data.finished) throw new HttpsError("failed-precondition", "Quiz already completed.");
    if (!data.inFlight) throw new HttpsError("failed-precondition", "No question in flight.");
    // Reject stale / duplicate submits — index must match the live question.
    if (index !== data.currentIndex) {
      throw new HttpsError("failed-precondition", "Answer is for the wrong question.");
    }

    const inFlight = data.inFlight;
    const elapsedMs = Date.now() - inFlight.servedAt.toMillis();
    const scored = scoreAnswer({
      elapsedMs,
      choiceIdx: choiceIndex ?? null,
      correctIdx: inFlight.shuffledCorrectIndex,
    });

    const answers = data.answers.concat({
      questionId: inFlight.questionId,
      choiceIndex: choiceIndex ?? null,
      correct: scored.correct,
      timedOut: scored.timedOut,
      points: scored.pointsAwarded,
      elapsedMs,
    });
    const newScore = data.score + scored.pointsAwarded;
    const nextIndex = data.currentIndex + 1;
    const done = nextIndex >= data.order.length;

    // Never reveal the correct option — only whether the player was right.
    const result = {
      correct: scored.correct,
      timedOut: scored.timedOut,
      pointsAwarded: scored.pointsAwarded,
    };

    if (done) {
      tx.update(ref, {
        answers,
        score: newScore,
        currentIndex: nextIndex,
        inFlight: null,
        finished: true,
        finishedAt: Timestamp.now(),
      });
      // Public leaderboard row: name + score only.
      tx.set(db.collection("leaderboard").doc(auth.uid), {
        displayName: data.displayName,
        twitchLogin: data.twitchLogin,
        score: newScore,
        finishedAt: Timestamp.now(),
      });
      return { result, done: true, finalScore: newScore, total: data.order.length };
    }

    // Serve the next question with a fresh timer.
    const nextQ = (await tx.get(db.collection("questions").doc(data.order[nextIndex]))).data();
    const served = serveQuestion({ id: data.order[nextIndex], ...nextQ });
    tx.update(ref, {
      answers,
      score: newScore,
      currentIndex: nextIndex,
      inFlight: served.inFlight,
    });

    return {
      result,
      done: false,
      index: nextIndex,
      total: data.order.length,
      remainingMs: QUIZ.windowMs,
      question: served.publicQuestion,
    };
  });
}
