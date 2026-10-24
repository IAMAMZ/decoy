import { PhoneScreen } from '../components/PhoneScreen';
import type { CallState } from '../events/reducer';

export function Call({ state }: { state: CallState }) {
  return (
    <div className="solo">
      <PhoneScreen state={state} />
    </div>
  );
}
