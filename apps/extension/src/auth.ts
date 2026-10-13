export interface IdentityPort {
  getRedirectURL(path?: string): string;
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
}

export class ExtensionAuth {
  private token: string | undefined;
  private expiresAt = 0;
  private generation = 0;
  private readonly identity: IdentityPort;
  private readonly origin: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(identity: IdentityPort, origin: string, fetcher: typeof fetch = (input, init) => fetch(input, init), now: () => number = Date.now) {
    this.identity = identity;
    this.origin = origin;
    this.fetcher = fetcher;
    this.now = now;
  }

  authorization(): string | undefined {
    if (this.token && this.expiresAt <= this.now()) this.clear();
    return this.token ? `Bearer ${this.token}` : undefined;
  }

  async signIn(): Promise<void> {
    const generation = ++this.generation;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const verifier = this.base64url(bytes);
    const challenge = this.base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const callback = this.identity.getRedirectURL('klaro');
    const start = new URL('/auth/extension/login', this.origin);
    start.searchParams.set('redirectUri', callback);
    start.searchParams.set('codeChallenge', challenge);
    const final = await this.identity.launchWebAuthFlow({ url: start.href, interactive: true });
    if (!final || generation !== this.generation) return;
    const returned = new URL(final);
    if (`${returned.origin}${returned.pathname}` !== callback || returned.searchParams.getAll('code').length !== 1) throw new Error('Invalid auth redirect');
    const response = await this.fetcher(new URL('/auth/extension/exchange', this.origin), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: returned.searchParams.get('code'), verifier }), credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error('Authentication failed');
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('token' in result) || typeof result.token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(result.token) || !('expiresAt' in result) || typeof result.expiresAt !== 'string') throw new Error('Invalid session response');
    const expiresAt = Date.parse(result.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now() || expiresAt > this.now() + 900000) throw new Error('Invalid session expiry');
    if (generation !== this.generation) {
      await this.revoke(result.token);
      return;
    }
    this.token = result.token;
    this.expiresAt = expiresAt;
  }

  async signOut(): Promise<void> {
    const token = this.token;
    this.clear();
    if (token) await this.revoke(token);
  }

  dispose(): void { this.clear(); }

  private clear(): void {
    this.generation++;
    this.token = undefined;
    this.expiresAt = 0;
  }

  private async revoke(token: string): Promise<void> {
    await this.fetcher(new URL('/auth/extension/logout', this.origin), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', cache: 'no-store' }).catch(() => undefined);
  }

  private base64url(value: Uint8Array): string {
    return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
