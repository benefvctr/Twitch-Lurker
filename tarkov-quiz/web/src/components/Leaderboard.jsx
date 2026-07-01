import { useEffect, useState } from "react";
import { subscribeLeaderboard } from "../api.js";

export default function Leaderboard() {
  const [rows, setRows] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = subscribeLeaderboard((data) => {
      setRows(data);
      setReady(true);
    });
    return unsub;
  }, []);

  return (
    <div className="panel leaderboard">
      <h3>Leaderboard</h3>
      {!ready && <p className="muted">Loading…</p>}
      {ready && rows.length === 0 && (
        <p className="muted">No entries yet — be the first.</p>
      )}
      {rows.length > 0 && (
        <ol className="board">
          {rows.map((r, i) => (
            <li key={r.id}>
              <span className="rank">{i + 1}</span>
              <span className="name">{r.displayName}</span>
              <span className="pts">{(r.score ?? 0).toLocaleString()}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
