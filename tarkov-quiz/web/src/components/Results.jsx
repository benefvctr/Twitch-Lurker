export default function Results({ score }) {
  return (
    <div className="panel">
      <h2>Run complete.</h2>
      <p className="final-score">{(score ?? 0).toLocaleString()} pts</p>
      <p className="muted">
        Your score is locked in — one attempt per Twitch account. Check the
        leaderboard below to see where you landed. Good luck in the giveaway!
      </p>
    </div>
  );
}
