import type { CallState } from '../events/reducer';
import { BRAND, Logo } from './Brand';
import { fmtClock, useNow } from './format';

export function PhoneScreen({ state }: { state: CallState }) {
  const now = useNow(500);
  const { status, mode, tools, avatar } = state;
  const elapsed = state.startedAt ? (state.endedAt ?? now) - state.startedAt : 0;
  const doneTool = (name: string) => tools.find((t) => t.tool === name && t.status === 'done');
  const verify = doneTool('verify_institution');
  const realVerify = doneTool('verify_caller_number'); // the real-browser check is RBC-specific
  const frozen = doneTool('freeze_transaction')?.result as { amount?: number } | undefined;
  const notified = doneTool('notify_family');
  const claimed = (verify?.args.claimed_org as string | undefined) ?? (realVerify ? 'RBC' : null);
  const notReally =
    (verify && (verify.result as { match?: boolean })?.match === false) ||
    (realVerify && (realVerify.result as { verdict?: string })?.verdict === 'mismatch');
  const checks = [
    notReally && `Not really ${claimed}`,
    frozen && `$${(frozen.amount ?? 0).toLocaleString('en-US')} transfer paused`,
    notified &&
      !(notified.result as { error?: boolean })?.error &&
      `${String(notified.args.contact ?? 'Family').split(' ')[0]} has been notified`,
  ].filter(Boolean) as string[];

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

            {mode === 'takeover' && avatar && <AvatarPanel avatar={avatar} now={now} />}

            <div className="phone-controls">
              <span className="pc" />
              <span className="pc" />
              <span className={`pc pc-end ${status === 'ended' ? 'off' : ''}`} />
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
