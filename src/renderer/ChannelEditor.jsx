import React, { useEffect, useState } from 'react';

export function ChannelEditor() {
  const [channels, setChannels] = useState([]);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    window.lurker.getChannels().then(setChannels);
  }, []);

  const save = async () => {
    await window.lurker.setChannels(channels);
    setDirty(false);
  };

  const add = () => {
    const v = draft.trim()
      .replace(/^https?:\/\/(www\.)?twitch\.tv\//, '')
      .replace(/\/.*$/, '');
    if (!v) return;
    if (channels.includes(v)) return;
    setChannels([...channels, v]);
    setDraft('');
    setDirty(true);
  };

  const remove = (ch) => {
    setChannels(channels.filter(c => c !== ch));
    setDirty(true);
  };

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= channels.length) return;
    const next = [...channels];
    [next[i], next[j]] = [next[j], next[i]];
    setChannels(next);
    setDirty(true);
  };

  return (
    <div className="channel-editor">
      {channels.length === 0 ? (
        <div className="empty-state">NO CHANNELS — ADD ONE BELOW</div>
      ) : (
        <ul className="channel-list">
          {channels.map((ch, i) => (
            <li key={ch}>
              <span className="ch-index">{String(i + 1).padStart(2, '0')}</span>
              <span className="ch-name">{ch}</span>
              <span className="ch-actions">
                <button className="btn-icon" onClick={() => move(i, -1)} title="Move up">
                  UP
                </button>
                <button className="btn-icon" onClick={() => move(i, 1)} title="Move down">
                  DN
                </button>
                <button className="btn-icon remove" onClick={() => remove(ch)}>
                  DEL
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="add-row">
        <input
          placeholder="channel name or twitch.tv/url"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button className="btn-add" onClick={add}>ADD</button>
      </div>

      <div className="save-row">
        <span className={`save-hint${dirty ? ' has-changes' : ''}`}>
          {dirty ? 'UNSAVED CHANGES' : 'ALL CHANGES SAVED'}
        </span>
        <button className="btn-save" onClick={save} disabled={!dirty}>
          SAVE
        </button>
      </div>
    </div>
  );
}
