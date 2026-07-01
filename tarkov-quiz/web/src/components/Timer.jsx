import { useEffect, useRef, useState } from "react";

// Visual countdown ring. Starts from `startMs` and fires onExpire once at zero.
// This is purely cosmetic — the server independently enforces the real deadline.
export default function Timer({ startMs, windowMs = 7000, onExpire }) {
  const [remaining, setRemaining] = useState(startMs);
  const expiredRef = useRef(false);
  const deadlineRef = useRef(0);

  useEffect(() => {
    expiredRef.current = false;
    setRemaining(startMs);
    deadlineRef.current = Date.now() + startMs;

    const tick = () => {
      const left = Math.max(0, deadlineRef.current - Date.now());
      setRemaining(left);
      if (left <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.();
      }
    };

    if (startMs <= 0) {
      // Resumed onto an already-expired question — expire immediately.
      tick();
      return;
    }

    const id = setInterval(tick, 50);
    return () => clearInterval(id);
    // Re-arm whenever a new question is served (startMs identity changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMs]);

  const seconds = (remaining / 1000).toFixed(1);
  const pct = Math.max(0, Math.min(100, (remaining / windowMs) * 100));
  const danger = remaining <= 2000;

  return (
    <div className="timer">
      <div className="timer-bar-track">
        <div
          className={`timer-bar-fill${danger ? " danger" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`timer-readout${danger ? " danger" : ""}`}>{seconds}s</div>
    </div>
  );
}
