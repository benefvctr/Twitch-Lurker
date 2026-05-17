import React, { useEffect, useState, useCallback } from 'react';
import { ChannelEditor } from './ChannelEditor.jsx';
import { SetupWizard } from './SetupWizard.jsx';

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

function LiveBadge({ live }) {
  const map = {
    live:    { cls: 'live-badge is-live',    label: 'LIVE'    },
    offline: { cls: 'live-badge is-offline', label: 'OFFLINE' },
    unknown: { cls: 'live-badge is-unknown', label: 'WAIT'    },
  };
  const { cls, label } = map[live] ?? map.unknown;
  return (
    <span className={cls}>
      <span className="live-dot" />
      {label}
    </span>
  );
}

function AboutModal({ onClose }) {
  const [version, setVersion] = useState('...');
  const [logPath, setLogPath] = useState(null);

  useEffect(() => {
    window.lurker.getVersion().then(setVersion).catch(() => setVersion('0.2.1'));
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
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  const loadConfig = useCallback(async () => {
    const cfg = await window.lurker.getConfig();
    setConfig(cfg);
  }, []);

  useEffect(() => {
    window.lurker.getStatus().then(setStatus);
    loadConfig();
    return window.lurker.onStatusChanged((s) => {
      setStatus(s);
      // Clear starting/stopping when we get a confirmed running state
      if (s.running) {
        setIsStarting(false);
      } else {
        setIsStopping(false);
      }
    });
  }, [loadConfig]);

  const handleStart = async () => {
    setIsStarting(true);
    setStartError(null);
    setErrorExpanded(false);
    try {
      await window.lurker.start();
    } catch (e) {
      setStartError(e?.message ?? String(e));
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
            <button className="error-banner-close" onClick={() => { setStartError(null); setErrorExpanded(false); }}>X</button>
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
                      <LiveBadge live={c.live} />
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
