import { TWITCH_LOGIN_URL } from "../firebase.js";

export default function Landing({ authError }) {
  return (
    <div className="panel">
      <h2>Prove you know Tarkov.</h2>
      <ul className="rules">
        <li>Multiple choice. <strong>7 seconds</strong> per question — answer fast, no time to Google.</li>
        <li>Faster correct answers score more points.</li>
        <li><strong>One attempt per Twitch account.</strong> No retries, so make them count.</li>
        <li>Highest score wins the giveaway. Ties broken by who finished first.</li>
      </ul>

      {authError && <p className="error">Login error: {authError}</p>}

      <a className="btn btn-twitch" href={TWITCH_LOGIN_URL}>
        Sign in with Twitch to play
      </a>
      <p className="muted small">
        We only read your Twitch username to identify your entry.
      </p>
    </div>
  );
}
