import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

interface Handoff {
  challenge: Buffer;
  token: string;
  expiresAt: Date;
  codeExpiresAt: number;
}

function hash(value: string): Buffer { return createHash('sha256').update(value).digest(); }

export class HandoffService {
  private readonly codes = new Map<string, Handoff>();
  constructor(private readonly now: () => number = Date.now) {}

  issue(challenge: string, token: string, expiresAt: Date): string {
    for (const [key, item] of this.codes) if (item.codeExpiresAt <= this.now()) this.codes.delete(key);
    if (!/^[a-zA-Z0-9_-]{43}$/.test(challenge) || this.codes.size >= 1000) throw new Error('Invalid handoff');
    const code = randomBytes(32).toString('base64url');
    this.codes.set(hash(code).toString('hex'), { challenge: Buffer.from(challenge, 'base64url'), token, expiresAt, codeExpiresAt: this.now() + 60000 });
    return code;
  }

  exchange(code: string, verifier: string): { token: string; expiresAt: string } {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(code) || !/^[a-zA-Z0-9_-]{43,128}$/.test(verifier)) throw new Error('Invalid handoff');
    const key = hash(code).toString('hex');
    const item = this.codes.get(key);
    if (!item || item.codeExpiresAt <= this.now() || item.expiresAt.getTime() <= this.now() || !timingSafeEqual(item.challenge, hash(verifier))) throw new Error('Invalid handoff');
    this.codes.delete(key);
    return { token: item.token, expiresAt: item.expiresAt.toISOString() };
  }
}
