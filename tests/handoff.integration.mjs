import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { HandoffService } from '../dist/api/identity/handoff.js';

let now = Date.now();
const handoffs = new HandoffService(() => now);
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const expiry = new Date(now + 900000);
const code = handoffs.issue(challenge, 'synthetic-token', expiry);
assert.throws(() => handoffs.exchange(code, 'b'.repeat(43)));
assert.equal(handoffs.exchange(code, verifier).token, 'synthetic-token');
assert.throws(() => handoffs.exchange(code, verifier));
const expired = handoffs.issue(challenge, 'synthetic-token', expiry);
now += 60001;
assert.throws(() => handoffs.exchange(expired, verifier));
console.info('Handoff proof, one-time exchange and expiry passed');
