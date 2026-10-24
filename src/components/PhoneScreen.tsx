import { endCall } from '../audio';
import type { CallState } from '../events/reducer';
import type { CallEvent } from '../events/types';
import { MIC } from '../events/useCallEvents';
import { BRAND, Logo } from './Brand';
import { fmtClock, useNow } from './format';

export function PhoneScreen({ state, inject }: { state: CallState; inject: (ev: CallEvent) => void }) {
  const now = useNow(500);
  const { status, mode, tools, avatar } = state;
  const elapsed = state.startedAt ? (state.endedAt ?? now) - state.startedAt : 0;
  const doneTool = (name: string) => tools.find((t) => t.tool === name && t.status === 'done');
  const verify = doneTool('verify_institution'); // the scripted replay's check
  // The investigator's check of the caller's number, on the live web.
  const callerCheck = tools.find((t) => t.tool === 'investigate' && t.args.kind === 'caller' && t.status === 'done');
  const frozen = doneTool('freeze_transaction')?.result as { amount?: number } | undefined;
  const notified = doneTool('notify_family');
  const claimed = ((verify ?? callerCheck)?.args.claimed_org as string | undefined) ?? null;
  const notReally =
    (verify && (verify.result as { match?: boolean })?.match === false) ||
    (callerCheck && (callerCheck.result as { verdict?: string })?.verdict === 'contradicted');
  const checks = [
    notReally && `Not really ${claimed}`,
    frozen && (frozen.amount ? `$${frozen.amount.toLocaleString('en-US')} transfer paused` : 'Outbound transfers paused'),
    notified &&
      !(notified.result as { error?: boolean })?.error &&
      `${String(notified.args.contact ?? 'Family').split(' ')[0]} has been notified`,
  ].filter(Boolean) as string[];
  const ev = (type: CallEvent['type'], data: object) =>
    ({ type, call_id: state.callId ?? 'demo', ts: Date.now(), data }) as CallEvent;
  const asking = status === 'active' && mode !== 'takeover' && state.takeoverOffer === 'asking';
  // Live: hang up the real call (the voice loop emits call_ended). Replay: just end it on screen.
  const hangUp = () => (MIC ? endCall() : inject(ev('call_ended', {})));

  return (
    <div className="phone-wrap">
      <div className="phone-caption">Customer's phone</div>
      <div className={`phone mode-${mode} status-${status}`}>
        <div className="phone-notch" />
        <div className="phone-status">
          <span>{new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          <span>5G</span>
        </div>

        {status === 'idle' ? (
          <div className="phone-idle">
            <div className="phone-clock">{new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
            <p>No active call</p>
          </div>
        ) : (
          <div className="phone-call">
            <div className="caller-id">
              <div className="caller-avatar">{claimed ? claimed[0] : '?'}</div>
              <div className="caller-number">{state.callerNumber ?? 'Unknown number'}</div>
              <div className="caller-sub">
                {status === 'ended' ? 'Call ended' : fmtClock(elapsed)}
                {claimed && ` · says they're ${claimed}`}
              </div>
            </div>

            {mode !== 'monitoring' && (
              <div className={`alert enter alert-${mode}`}>
                <div className="alert-title">{mode === 'takeover' ? 'Scam call. You’re protected.' : 'This may be a scam call'}</div>
                <ul>
                  {checks.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {asking && (
              <div className="offer enter" role="dialog" aria-label="Let Decoy take this call?">
                <div className="alert-title">Let {BRAND} take this call?</div>
                <p>{BRAND} will talk to the caller in your voice. You can hang up.</p>
                <div className="offer-actions">
                  <button className="offer-no" onClick={() => inject(ev('takeover_offer', { status: 'declined' }))}>
                    Not now
                  </button>
                  <button className="offer-yes" onClick={() => inject(ev('mode', { mode: 'takeover' }))}>
                    Take over
                  </button>
                </div>
              </div>
            )}

            {mode === 'takeover' && avatar && <AvatarPanel avatar={avatar} now={now} />}

            <div className="phone-controls">
              {/* Speaker: looks the part, does nothing. */}
              <button className="pc" aria-label="Speaker">
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M4 9v6h4l5 4V5L8 9H4z" />
                  <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" />
                </svg>
              </button>
              <button className="pc pc-end" aria-label="End call" disabled={status === 'ended'} onClick={hangUp}>
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M3 14.5c5-5 13-5 18 0l-2.5 2.5-3.5-1.5v-2.5a10 10 0 0 0-6 0v2.5L5.5 17 3 14.5z" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Placeholder face until the Higgs Avatar video is wired in: pass data.video_url on the avatar event.
function AvatarPanel({ avatar, now }: { avatar: NonNullable<CallState['avatar']>; now: number }) {
  const speaking = now - avatar.ts < avatar.text.split(' ').length * 380;
  return (
    <div className="avatar enter">
      {avatar.videoUrl ? (
        <video className="avatar-video" src={avatar.videoUrl} autoPlay playsInline />
      ) : (
        <div className={`avatar-face ${speaking ? 'speaking' : ''}`}>
          <Logo size={44} />
          <div className="wave" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} style={{ animationDelay: `${(i % 4) * 0.09}s` }} />
            ))}
          </div>
        </div>
      )}
      <p className="avatar-who">{BRAND} assistant</p>
      <p className="avatar-text">{avatar.text}</p>
      <span className="credit">Higgs Avatar</span>
    </div>
  );
}
