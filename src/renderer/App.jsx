import React, { useEffect, useState, useCallback } from 'react';
import { ChannelEditor } from './ChannelEditor.jsx';
import { SetupWizard } from './SetupWizard.jsx';

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function SysStatusPill({ running, channelCount }) {
  let cls, label;
  if (running) {
    cls = 'sys-status sys-status--live';
    label = 'LIVE';
  } else if (channelCount === 0) {
    cls = 'sys-status sys-status--offline';
    label = 'OFFLINE';
  } else {
    cls = 'sys-status sys-status--standby';
    label = 'STANDBY';
  }
  return (
    <span className={cls}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

function LiveBadge({ live, lastUpdated }) {
  // GATED: error state meaning subscriber-only/login-required
  if (live === 'gated') {
    return (
      <span className="live-badge is-gated">
        <span className="live-dot" />
        GATED
      </span>
    );
  }
  if (live === 'live') {
    return (
      <span className="live-badge is-live">
        <span className="live-dot" />
        LIVE
      </span>
    );
  }
  if (live === 'offline') {
    return (
      <span className="live-badge is-offline">
        <span className="live-dot" />
        OFFLINE
      </span>
    );
  }
  // unknown: WAIT vs STALE based on lastUpdated
  const isStale = lastUpdated != null && (Date.now() - lastUpdated) >= STALE_THRESHOLD_MS;
  if (isStale) {
    return (
      <span className="live-badge is-stale">
        <span className="live-dot" />
        STALE
      </span>
    );
  }
  return (
    <span className="live-badge is-unknown">
      <span className="live-dot" />
      WAIT
    </span>
  );
}

function AboutModal({ onClose }) {
  const [version, setVersion] = useState('...');
  const [logPath, setLogPath] = useState(null);

  useEffect(() => {
    window.lurker.getVersion().then(setVersion).catch(() => setVersion('0.2.4'));
    window.lurker.getLogPath().then(setLogPath).catch(() => setLogPath(null));
  }, []);

  const openRepo = () => {
    window.lurker.openExternal('https://github.com/benefvctr/Twitch-Lurker');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            LURKER<span className="slash">//</span>OBS
          </span>
          <button className="modal-close" onClick={onClose}>X</button>
        </div>
        <div className="modal-sep">{'─'.repeat(32)}</div>
        <div className="modal-body">
          <div className="modal-version">v{version}</div>
          <p className="modal-desc">
            Auto-opens Twitch streams in a hidden Firefox to maintain watch streaks and accrue
            channel points. Single-user personal utility.
          </p>
          <button className="wizard-link-btn modal-repo-link" onClick={openRepo}>
            github.com/benefvctr/Twitch-Lurker
          </button>
          {logPath && (
            <div className="modal-log-row">
              <div className="modal-log-label">LOG FILE</div>
              <div className="modal-log-path">{logPath}</div>
              <button className="modal-log-btn" onClick={() => window.lurker.openLog()}>
                OPEN LOG FOLDER
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [status, setStatus] = useState({ running: false, channels: [] });
  const [config, setConfig] = useState(null);
  const [view, setView] = useState('status');
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [startError, setStartError] = useState(null);
  const [errorExpanded, setErrorExpanded] = useState(true);
  const [showAbout, setShowAbout] = useState(false);
  const [loginRequired, setLoginRequired] = useState(false);
  // BUG 2: track which channel triggered login-required so reopenChannel can target it
  const [loginRequiredChannel, setLoginRequiredChannel] = useState(null);

  const loadConfig = useCallback(async () => {
    const cfg = await window.lurker.getConfig();
    setConfig(cfg);
  }, []);

  useEffect(() => {
    window.lurker.getStatus().then(setStatus);
    loadConfig();

    const unsubStatus = window.lurker.onStatusChanged((s) => {
      setStatus(s);
      // Clear starting/stopping when we get a confirmed running state
      if (s.running) {
        setIsStarting(false);
        // Clear error banner on successful start
        setStartError(null);
        setErrorExpanded(true);
      } else {
        setIsStopping(false);
      }
    });

    // #9: Subscribe to lifecycle errors pushed from main process
    const unsubLifecycleError = window.lurker.onLifecycleError((payload) => {
      setStartError(payload.error ?? 'Unknown lifecycle error');
      setIsStarting(false);
    });

    const unsubGiveUp = window.lurker.onGiveUp((payload) => {
      setStartError(`Self-heal gave up after repeated failures: ${payload.error ?? ''}`);
      setIsStarting(false);
    });

    // #12: Login required banner — store channel for targeted reopen (BUG 2)
    const unsubLoginRequired = window.lurker.onLoginRequired(({ channel }) => {
      setLoginRequired(true);
      setLoginRequiredChannel(channel ?? null);
    });

    return () => {
      unsubStatus();
      unsubLifecycleError();
      unsubGiveUp();
      unsubLoginRequired();
    };
  }, [loadConfig]);

  const handleStart = async () => {
    setIsStarting(true);
    setStartError(null);
    setErrorExpanded(true);
    try {
      await window.lurker.start();
    } catch (e) {
      // #10: Strip IPC prefix from error messages
      const raw = e?.message ?? String(e);
      const msg = raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
      setStartError(msg);
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      await window.lurker.stop();
    } catch {
      setIsStopping(false);
    }
  };

  const handleRetry = async () => {
    setIsStarting(true);
    setStartError(null);
    try {
      await window.lurker.retryStart();
    } catch (e) {
      const raw = e?.message ?? String(e);
      const msg = raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
      setStartError(msg);
      setIsStarting(false);
    }
  };

  const handleToggle = () => {
    if (status.running) {
      handleStop();
    } else {
      handleStart();
    }
  };

  const handleSetupDone = async () => {
    await loadConfig();
  };

  // Show setup wizard for first-time users
  if (config === null) {
    // Still loading config
    return (
      <div className="app">
        <div className="empty-state" style={{ marginTop: '80px' }}>LOADING...</div>
      </div>
    );
  }

  if (!config.firstRunComplete) {
    return (
      <div className="app">
        <SetupWizard onDone={handleSetupDone} />
      </div>
    );
  }

  const toggleLabel = status.running
    ? (isStopping ? '[ STOPPING... ]' : '[ STOP ]')
    : (isStarting ? '[ STARTING... ]' : '[ START ]');

  const toggleDisabled = isStarting || isStopping;

  // Derive GATED live state from lastError for channel row display
  function getEffectiveLive(ch) {
    if (ch.lastError === 'GATED') return 'gated';
    return ch.live;
  }

  return (
    <div className="app">
      {/* ---- Error banner ---- */}
      {startError && (
        <div className={`error-banner${errorExpanded ? ' error-banner--expanded' : ''}`}>
          <span className="error-banner-icon">!</span>
          <div className="error-banner-body">
            {errorExpanded ? (
              <div className="error-banner-full">{startError}</div>
            ) : (
              <span className="error-banner-msg">{startError}</span>
            )}
          </div>
          <div className="error-banner-actions">
            <button
              className="error-banner-action"
              onClick={handleRetry}
              title="retry start"
              disabled={isStarting}
            >
              [retry]
            </button>
            <button
              className="error-banner-action"
              onClick={() => setErrorExpanded(x => !x)}
              title={errorExpanded ? 'collapse' : 'expand'}
            >
              {errorExpanded ? '[collapse]' : '[expand]'}
            </button>
            <button
              className="error-banner-action"
              onClick={() => navigator.clipboard.writeText(startError)}
              title="copy error to clipboard"
            >
              [copy]
            </button>
            <button
              className="error-banner-action"
              onClick={() => window.lurker.openLog()}
              title="open log file in Explorer"
            >
              [log]
            </button>
            <button className="error-banner-close" onClick={() => { setStartError(null); setErrorExpanded(true); }}>X</button>
          </div>
        </div>
      )}

      {/* ---- Login required sticky banner ---- */}
      {loginRequired && (
        <div className="error-banner error-banner--warning">
          <span className="error-banner-icon">!</span>
          <div className="error-banner-body">
            <span className="error-banner-msg">
              Twitch session expired. Sign in via the lurker Firefox and click Retry.
            </span>
          </div>
          <div className="error-banner-actions">
            <button
              className="error-banner-action"
              onClick={async () => {
                setLoginRequired(false);
                // BUG 2: reopen only the affected channel tab (not a full restart)
                if (loginRequiredChannel) {
                  try { await window.lurker.reopenChannel(loginRequiredChannel); } catch { /* ignore */ }
                }
              }}
              disabled={isStarting}
            >
              [retry]
            </button>
            <button className="error-banner-close" onClick={() => setLoginRequired(false)}>X</button>
          </div>
        </div>
      )}

      {/* ---- About modal ---- */}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}

      {/* ---- Header ---- */}
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            LURKER<span className="slash">//</span>OBS
          </span>
          <span className="brand-sub">stream monitor</span>
        </div>

        <SysStatusPill running={status.running} channelCount={status.channels.length} />

        <nav className="app-nav">
          <button
            className={`nav-btn${view === 'status' ? ' active' : ''}`}
            onClick={() => setView('status')}
          >
            STATUS
          </button>
          <button
            className={`nav-btn${view === 'channels' ? ' active' : ''}`}
            onClick={() => setView('channels')}
          >
            CHANNELS
          </button>
          <button
            className="nav-btn about-btn"
            onClick={() => setShowAbout(true)}
            title="About"
          >
            ?
          </button>
        </nav>
      </header>

      {/* ---- Status view ---- */}
      {view === 'status' && (
        <div className="view">
          <div className="controls">
            <button
              className={`btn-toggle ${status.running ? 'stop' : 'start'}${toggleDisabled ? ' btn-toggle--loading' : ''}`}
              onClick={handleToggle}
              disabled={toggleDisabled}
            >
              {toggleLabel}
            </button>
            <button
              className="btn-secondary"
              onClick={() => window.lurker.refreshProfile()}
            >
              REFRESH PROFILE
            </button>
          </div>

          <div className="console-label">CHANNEL FEED</div>

          {status.channels.length === 0 ? (
            <div className="empty-state">NO CHANNELS CONFIGURED</div>
          ) : (
            <table className="status-table">
              <colgroup>
                <col className="col-index" />
                <col className="col-name" />
                <col className="col-live" />
                <col className="col-tab" />
                <col className="col-error" />
              </colgroup>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>CHANNEL</th>
                  <th className="num">STATE</th>
                  <th className="num">TAB</th>
                  <th>LAST ERROR</th>
                </tr>
              </thead>
              <tbody>
                {status.channels.map((c, i) => (
                  <tr key={c.name}>
                    <td className="td-index">
                      {String(i + 1).padStart(2, '0')}
                    </td>
                    <td className="td-name">{c.name}</td>
                    <td className="td-live">
                      <LiveBadge live={getEffectiveLive(c)} lastUpdated={c.lastUpdated} />
                    </td>
                    <td className={`td-tab${c.tabOpen ? ' is-open' : ''}`}>
                      {c.tabOpen ? 'OPEN' : '--'}
                    </td>
                    <td className="td-error">{c.lastError ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ---- Channels view ---- */}
      {view === 'channels' && (
        <div className="view">
          <div className="console-label">CHANNEL LIST</div>
          <ChannelEditor />
        </div>
      )}
    </div>
  );
}
