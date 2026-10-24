// Run: node src/audio/vad.check.mjs
import assert from 'node:assert/strict';
import { Vad } from './vad.ts';

const v = new Vad(0.02, 3);
assert.equal(v.push(0.005), null); // room noise
assert.equal(v.push(0.05), 'start');
assert.equal(v.push(0.015), 'speech'); // quieter speech still counts
assert.equal(v.push(0), 'speech');
assert.equal(v.push(0.03), 'speech'); // a short pause doesn't end the turn
assert.equal(v.push(0), 'speech');
assert.equal(v.push(0), 'speech');
assert.equal(v.push(0), 'end');
assert.equal(v.voiced, 3);
assert.equal(v.push(0.005), null); // ready for the next turn
v.push(0.05);
v.reset();
assert.equal(v.push(0.005), null);

// A noisy room: once the floor settles, noise above `on` no longer starts turns, speech still does.
const n = new Vad(0.02, 3);
let starts = 0;
for (let i = 0; i < 100; i++) if (n.push(0.01) === 'start') starts++;
for (let i = 0; i < 50; i++) if (n.push(0.03) === 'start') starts++, n.reset();
assert.ok(starts < 10, `noise started ${starts} turns`);
assert.equal(n.push(0.03), null);
assert.equal(n.push(0.2), 'start');
console.log('vad ok');
