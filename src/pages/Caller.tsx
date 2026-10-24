import { useState } from 'react';
import { endCall, startCall } from '../audio';

// The scammer's "phone". Audio is Young's module; this page only starts and ends the call.
export function Caller() {
  const [onCall, setOnCall] = useState(false);
  return (
    <div className="solo caller">
      <h1>Caller</h1>
      <p className="muted">Mic in, speaker out. Play the scammer.</p>
      {onCall ? (
        <button className="btn btn-big btn-danger" onClick={() => endCall().then(() => setOnCall(false))}>
          End call
        </button>
      ) : (
        <button className="btn btn-big" onClick={() => startCall().then(() => setOnCall(true))}>
          Start call
        </button>
      )}
    </div>
  );
}
