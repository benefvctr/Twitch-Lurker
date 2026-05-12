import React, { useEffect, useState } from 'react';
import { ChannelEditor } from './ChannelEditor.jsx';

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

export function App() {
  const [status, setStatus] = useState({ running: false, channels: [] });
  const [view, setView] = useState('status');

  useEffect(() => {
    window.lurker.getStatus().then(setStatus);
    return window.lurker.onStatusChanged(setStatus);
  }, []);

  const handleToggle = () => {
    status.running ? window.lurker.stop() : window.lurker.start();
  };

  return (
    <div className="app">
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
        </nav>
      </header>

      {/* ---- Status view ---- */}
      {view === 'status' && (
        <div className="view">
          <div className="controls">
            <button
              className={`btn-toggle ${status.running ? 'stop' : 'start'}`}
              onClick={handleToggle}
            >
              {status.running ? '[ STOP ]' : '[ START ]'}
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
