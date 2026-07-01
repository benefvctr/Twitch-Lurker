import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithCustomToken, signOut } from "firebase/auth";
import { auth } from "./firebase.js";
import Landing from "./components/Landing.jsx";
import Quiz from "./components/Quiz.jsx";
import Results from "./components/Results.jsx";
import Leaderboard from "./components/Leaderboard.jsx";

// Pull the custom token (or an auth error) out of the URL fragment that the
// twitchCallback function redirected us back with, then scrub it from the URL.
function consumeAuthHash() {
  if (!window.location.hash) return {};
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token");
  const authError = params.get("authError");
  const name = params.get("name");
  if (token || authError) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return { token, authError, name };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [authError, setAuthError] = useState(null);
  // phase: "playing" | "done"
  const [phase, setPhase] = useState("playing");
  const [finalScore, setFinalScore] = useState(null);

  // On first load, complete any Twitch sign-in handed back via the URL hash.
  useEffect(() => {
    const { token, authError: err } = consumeAuthHash();
    if (err) setAuthError(err);
    if (token) {
      signInWithCustomToken(auth, token).catch((e) =>
        setAuthError(e.message || "Sign-in failed.")
      );
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setBooting(false);
    });
  }, []);

  function handleFinish(score) {
    setFinalScore(score);
    setPhase("done");
  }

  async function handleLogout() {
    await signOut(auth);
    setPhase("playing");
    setFinalScore(null);
  }

  if (booting) {
    return (
      <div className="app">
        <div className="panel muted">Connecting…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>TARKOV QUIZ</h1>
        {user && (
          <div className="user-chip">
            <span>{user.displayName || "Operator"}</span>
            <button className="link" onClick={handleLogout}>
              sign out
            </button>
          </div>
        )}
      </header>

      {!user && <Landing authError={authError} />}

      {user && phase !== "done" && (
        <Quiz user={user} onFinish={handleFinish} />
      )}

      {user && phase === "done" && <Results score={finalScore} />}

      <Leaderboard />
    </div>
  );
}
