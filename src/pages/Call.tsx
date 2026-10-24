import { PhoneScreen } from '../components/PhoneScreen';
import type { CallState } from '../events/reducer';
import type { CallEvent } from '../events/types';

export function Call({ state, inject }: { state: CallState; inject: (ev: CallEvent) => void }) {
  return (
    <div className="solo">
      <PhoneScreen state={state} inject={inject} />
    </div>
  );
}
