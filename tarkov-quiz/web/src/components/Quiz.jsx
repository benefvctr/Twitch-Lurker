import { useRef, useState } from "react";
import { startQuiz, submitAnswer } from "../api.js";
import Timer from "./Timer.jsx";

function errMsg(e) {
  return e?.message || "Something went wrong. Try again.";
}

export default function Quiz({ onFinish }) {
  // status: "idle" | "loading" | "question" | "submitting" | "feedback" | "error"
  const [status, setStatus] = useState("idle");
  const [q, setQ] = useState(null);
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [runningScore, setRunningScore] = useState(0);
  const [error, setError] = useState(null);
  const answered = useRef(false);

  function loadQuestion(data) {
    answered.current = false;
    setSelected(null);
    setFeedback(null);
    setQ(data);
    setStatus("question");
  }

  async function begin() {
    setStatus("loading");
    setError(null);
    try {
      const data = await startQuiz();
      if (data.finished) {
        onFinish(data.score);
        return;
      }
      loadQuestion(data);
    } catch (e) {
      setError(errMsg(e));
      setStatus("error");
    }
  }

  async function answer(choiceIndex) {
    if (answered.current) return;
    answered.current = true;
    setSelected(choiceIndex);
    setStatus("submitting");
    try {
      const data = await submitAnswer(q.index, choiceIndex);
      setFeedback(data.result);
      setRunningScore((s) => s + (data.result?.pointsAwarded || 0));
      setStatus("feedback");
      setTimeout(() => {
        if (data.done) onFinish(data.finalScore);
        else loadQuestion(data);
      }, 1300);
    } catch (e) {
      setError(errMsg(e));
      setStatus("error");
    }
  }

  if (status === "idle") {
    return (
      <div className="panel">
        <h2>Ready?</h2>
        <p>
          The timer starts the instant you hit begin. Each question is live for{" "}
          <strong>7 seconds</strong>. Reloading the page does <em>not</em> reset
          the clock — you only get back the time that's left.
        </p>
        <button className="btn" onClick={begin}>
          Begin quiz
        </button>
      </div>
    );
  }

  if (status === "loading") {
    return <div className="panel muted">Loading question…</div>;
  }

  if (status === "error") {
    return (
      <div className="panel">
        <p className="error">{error}</p>
        <button className="btn" onClick={begin}>
          Retry
        </button>
      </div>
    );
  }

  if (!q) return null;

  const locked = status !== "question";

  return (
    <div className="panel quiz">
      <div className="quiz-top">
        <span className="progress">
          Question {q.index + 1} / {q.total}
        </span>
        <span className="score">{runningScore.toLocaleString()} pts</span>
      </div>

      <Timer
        key={q.index}
        startMs={q.remainingMs}
        windowMs={7000}
        onExpire={() => answer(null)}
      />

      <h2 className="prompt">{q.question.prompt}</h2>

      {q.question.type === "image" && q.question.imageUrl && (
        <img className="question-image" src={q.question.imageUrl} alt="" />
      )}

      <div className="options">
        {q.question.options.map((opt, i) => {
          let cls = "option";
          if (selected === i) {
            if (status === "feedback" && feedback) {
              cls += feedback.correct ? " correct" : " wrong";
            } else {
              cls += " selected";
            }
          }
          return (
            <button
              key={i}
              className={cls}
              disabled={locked}
              onClick={() => answer(i)}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {status === "feedback" && feedback && (
        <div className={`feedback ${feedback.correct ? "correct" : "wrong"}`}>
          {feedback.timedOut
            ? "Time's up!"
            : feedback.correct
            ? `Correct! +${feedback.pointsAwarded}`
            : "Wrong"}
        </div>
      )}
    </div>
  );
}
