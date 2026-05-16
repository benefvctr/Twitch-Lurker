import React, { useEffect, useState, useCallback } from 'react';
import { ChannelEditor } from './ChannelEditor.jsx';

/* =========================================================
   LURKER//OBS :: SETUP WIZARD
   5-step first-run onboarding. Surveillance-console aesthetic.
   ========================================================= */

function WizardHeader({ step }) {
  return (
    <div className="wizard-header">
      <span className="wizard-brand">
        LURKER<span className="slash">//</span>OBS
        <span className="wizard-brand-sep"> :: </span>
        SETUP
      </span>
      <span className="wizard-step-pill">
        [{String(step).padStart(2, '0')}/05]
      </span>
    </div>
  );
}

function WizardSep() {
  return <div className="wizard-sep">{'─'.repeat(48)}</div>;
}

/* ---- Step 1: Welcome ---- */
function StepWelcome({ onNext }) {
  return (
    <div className="wizard-step">
      <WizardHeader step={1} />
      <WizardSep />
      <div className="wizard-body">
        <div className="wizard-section-label">// WHAT IS THIS</div>
        <p className="wizard-copy">
          TwitchLurker runs a hidden Firefox in the background, opening your watched channels at
          the lowest quality so Twitch registers watch time and accrues channel points. The
          browser is moved off-screen so it does not interrupt your workflow.
        </p>
        <div className="wizard-section-label">// LEGAL NOTE</div>
        <p className="wizard-copy">
          Automating Twitch viewing is a gray area under Twitch Terms of Service. This tool is
          intended as a single-user personal utility. You run it at your own risk. It does not
          generate fake engagement or interact with chat.
        </p>
        <div className="wizard-section-label">// WHAT'S NEXT</div>
        <p className="wizard-copy">
          This wizard will verify your Firefox install, walk you through prerequisites, clone
          your browser profile, and configure your channel list. Setup takes about two minutes.
        </p>
      </div>
      <div className="wizard-footer">
        <button className="wizard-btn-primary" onClick={onNext}>
          BEGIN SETUP &gt;
        </button>
      </div>
    </div>
  );
}

/* ---- Step 2: Firefox check ---- */
function StepFirefox({ onNext, onBack }) {
  const [status, setStatus] = useState('checking'); // 'checking' | 'found' | 'not-found'
  const [detectedPath, setDetectedPath] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const check = useCallback(async () => {
    setStatus('checking');
    const result = await window.lurker.setup.detectFirefox();
    if (result.found) {
      setDetectedPath(result.path);
      setStatus('found');
    } else {
      setErrorMsg(result.error);
      setStatus('not-found');
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  return (
    <div className="wizard-step">
      <WizardHeader step={2} />
      <WizardSep />
      <div className="wizard-body">
        <div className="wizard-section-label">// FIREFOX DETECTION</div>
        <p className="wizard-copy">
          TwitchLurker clones your Firefox profile to inherit your Twitch login and extensions.
          Firefox must be installed before continuing.
        </p>

        {status === 'checking' && (
          <div className="wizard-status-row wizard-status--wait">
            <span className="wizard-dot wizard-dot--amber" />
            CHECKING...
          </div>
        )}

        {status === 'found' && (
          <>
            <div className="wizard-status-row wizard-status--ok">
              <span className="wizard-dot wizard-dot--green" />
              FIREFOX DETECTED
            </div>
            <div className="wizard-path">{detectedPath}</div>
          </>
        )}

        {status === 'not-found' && (
          <>
            <div className="wizard-status-row wizard-status--err">
              <span className="wizard-dot wizard-dot--red" />
              FIREFOX NOT FOUND
            </div>
            <div className="wizard-error-msg">{errorMsg}</div>
            <p className="wizard-copy">
              Download and install Firefox, then click Recheck.{' '}
              <button
                className="wizard-link-btn"
                onClick={() => window.lurker.openExternal('https://www.mozilla.org/firefox')}
              >
                mozilla.org/firefox
              </button>
            </p>
            <button className="wizard-btn-secondary" onClick={check}>
              RECHECK
            </button>
          </>
        )}
      </div>
      <div className="wizard-footer">
        <button className="wizard-btn-ghost" onClick={onBack}>&lt; BACK</button>
        <button
          className="wizard-btn-primary"
          onClick={onNext}
          disabled={status !== 'found'}
        >
          NEXT &gt;
        </button>
      </div>
    </div>
  );
}

/* ---- Step 3: Prerequisites ---- */
function StepPrereqs({ onNext, onBack }) {
  const [checked, setChecked] = useState(false);

  return (
    <div className="wizard-step">
      <WizardHeader step={3} />
      <WizardSep />
      <div className="wizard-body">
        <div className="wizard-section-label">// PREREQUISITES</div>

        <div className="wizard-prereq-item">
          <span className="wizard-prereq-num">01</span>
          <div className="wizard-prereq-body">
            <div className="wizard-prereq-title">Log in to Twitch in your normal Firefox</div>
            <div className="wizard-prereq-desc">
              The lurker clones your Firefox profile to inherit your Twitch session. Make sure you
              are already logged in before continuing.
            </div>
          </div>
        </div>

        <div className="wizard-prereq-item">
          <span className="wizard-prereq-num">02</span>
          <div className="wizard-prereq-body">
            <div className="wizard-prereq-title">Install a channel-points auto-claim extension</div>
            <div className="wizard-prereq-desc">
              Install an extension such as{' '}
              <button
                className="wizard-link-btn"
                onClick={() => window.lurker.openExternal('https://addons.mozilla.org/firefox/addon/twitch-points-autoclicker/')}
              >
                Auto Claim Twitch Channel Points
              </button>{' '}
              in your normal Firefox. The lurker profile will inherit it automatically.
            </div>
          </div>
        </div>

        <div className="wizard-section-label" style={{ marginTop: '16px' }}>// SYNC WARNING</div>
        <div className="wizard-warning-box">
          <p className="wizard-copy">
            If your Firefox is signed in to Mozilla Sync, the lurker may push its profile data back
            to your account. After the first launch of TwitchLurker, open the lurker Firefox window
            and sign out of Sync under Settings &gt; Sync. This prevents extensions from being
            mirrored back to your personal Firefox.
          </p>
        </div>

        <label className="wizard-checkbox-row">
          <input
            type="checkbox"
            className="wizard-checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
          />
          <span className="wizard-checkbox-label">
            I have logged in to Twitch and installed the channel-points extension in Firefox.
          </span>
        </label>
      </div>
      <div className="wizard-footer">
        <button className="wizard-btn-ghost" onClick={onBack}>&lt; BACK</button>
        <button
          className="wizard-btn-primary"
          onClick={onNext}
          disabled={!checked}
        >
          NEXT &gt;
        </button>
      </div>
    </div>
  );
}

/* ---- Step 4: Clone profile ---- */
function StepClone({ onNext, onBack }) {
  const [cloneStatus, setCloneStatus] = useState('idle'); // 'idle' | 'cloning' | 'done' | 'error'
  const [errorMsg, setErrorMsg] = useState(null);

  const doClone = async () => {
    setCloneStatus('cloning');
    const result = await window.lurker.setup.cloneProfile();
    if (result.ok) {
      setCloneStatus('done');
    } else {
      setErrorMsg(result.error);
      setCloneStatus('error');
    }
  };

  return (
    <div className="wizard-step">
      <WizardHeader step={4} />
      <WizardSep />
      <div className="wizard-body">
        <div className="wizard-section-label">// CLONE FIREFOX PROFILE</div>
        <p className="wizard-copy">
          TwitchLurker will copy your Firefox profile to a separate directory. This gives the lurker
          its own isolated Firefox that inherits your Twitch login and extensions without affecting
          your normal browser.
        </p>
        <p className="wizard-copy">
          Close Firefox completely before cloning to avoid locked files.
        </p>

        {cloneStatus === 'idle' && (
          <button className="wizard-btn-clone" onClick={doClone}>
            CLONE PROFILE
          </button>
        )}

        {cloneStatus === 'cloning' && (
          <div className="wizard-status-row wizard-status--wait">
            <span className="wizard-spinner" />
            CLONING... this may take a moment
          </div>
        )}

        {cloneStatus === 'done' && (
          <div className="wizard-status-row wizard-status--ok">
            <span className="wizard-dot wizard-dot--green" />
            PROFILE CLONED SUCCESSFULLY
          </div>
        )}

        {cloneStatus === 'error' && (
          <>
            <div className="wizard-status-row wizard-status--err">
              <span className="wizard-dot wizard-dot--red" />
              CLONE FAILED
            </div>
            <div className="wizard-error-msg">{errorMsg}</div>
            <button className="wizard-btn-secondary" onClick={doClone} style={{ marginTop: '12px' }}>
              RETRY
            </button>
          </>
        )}
      </div>
      <div className="wizard-footer">
        <button className="wizard-btn-ghost" onClick={onBack}>&lt; BACK</button>
        <button
          className="wizard-btn-primary"
          onClick={onNext}
          disabled={cloneStatus !== 'done'}
        >
          NEXT &gt;
        </button>
      </div>
    </div>
  );
}

/* ---- Step 5: Channels ---- */
function StepChannels({ onDone, onBack }) {
  const handleFinish = async () => {
    await window.lurker.setup.complete();
    onDone();
  };

  return (
    <div className="wizard-step">
      <WizardHeader step={5} />
      <WizardSep />
      <div className="wizard-body wizard-body--channels">
        <div className="wizard-section-label">// CONFIGURE CHANNELS</div>
        <p className="wizard-copy">
          Add the Twitch channels you want to lurk. You can change this list at any time from the
          main screen.
        </p>
        <ChannelEditor />
      </div>
      <div className="wizard-footer">
        <button className="wizard-btn-ghost" onClick={onBack}>&lt; BACK</button>
        <button className="wizard-btn-primary" onClick={handleFinish}>
          FINISH SETUP
        </button>
      </div>
    </div>
  );
}

/* ---- Wizard root ---- */
export function SetupWizard({ onDone }) {
  const [step, setStep] = useState(1);

  const next = () => setStep(s => Math.min(s + 1, 5));
  const back = () => setStep(s => Math.max(s - 1, 1));

  return (
    <div className="wizard-root">
      {step === 1 && <StepWelcome onNext={next} />}
      {step === 2 && <StepFirefox onNext={next} onBack={back} />}
      {step === 3 && <StepPrereqs onNext={next} onBack={back} />}
      {step === 4 && <StepClone onNext={next} onBack={back} />}
      {step === 5 && <StepChannels onDone={onDone} onBack={back} />}
    </div>
  );
}
