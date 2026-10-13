import { createHash, timingSafeEqual } from 'node:crypto';
import * as client from 'openid-client';

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  callbacks: string[];
  allowLoopbackHttp?: boolean;
}

interface PendingFlow {
  verifier: string;
  nonce: string;
  callback: string;
  binding: Buffer;
  expiresAt: number;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function validateUrl(value: string, allowLoopbackHttp: boolean): URL {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(allowLoopbackHttp && local && url.protocol === 'http:'))) throw new Error('Invalid OIDC URL');
  return url;
}

export class OidcService {
  private readonly flows = new Map<string, PendingFlow>();
  private configuration: Promise<client.Configuration> | undefined;
  private readonly issuer: URL;
  private readonly callbacks: Set<string>;

  constructor(private readonly settings: OidcSettings, private readonly now: () => number = Date.now) {
    this.issuer = validateUrl(settings.issuer, settings.allowLoopbackHttp ?? false);
    this.callbacks = new Set(settings.callbacks.map(value => validateUrl(value, settings.allowLoopbackHttp ?? false).href));
    if (!settings.clientId || this.callbacks.size === 0) throw new Error('Missing OIDC configuration');
  }

  private config(): Promise<client.Configuration> {
    if (!this.configuration) {
      this.configuration = client.discovery(this.issuer, this.settings.clientId,
        this.settings.clientSecret ? { client_secret: this.settings.clientSecret } : undefined,
        this.settings.clientSecret ? client.ClientSecretBasic(this.settings.clientSecret) : client.None(),
        { timeout: 10, execute: [client.enableNonRepudiationChecks, ...(this.settings.allowLoopbackHttp ? [client.allowInsecureRequests] : [])] },
      ).catch(() => {
        this.configuration = undefined;
        throw new Error('OIDC provider unavailable');
      });
    }
    return this.configuration;
  }

  private cleanup(): void {
    for (const [state, flow] of this.flows) if (flow.expiresAt <= this.now()) this.flows.delete(state);
  }

  async begin(callback: string, browserBinding: string): Promise<URL> {
    this.cleanup();
    if (!this.callbacks.has(callback) || browserBinding.length < 32 || this.flows.size >= 1000) throw new Error('Invalid OIDC flow');
    const config = await this.config();
    if (this.flows.size >= 1000) throw new Error('OIDC flow capacity reached');
    const verifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const codeChallenge = await client.calculatePKCECodeChallenge(verifier);
    this.flows.set(state, { verifier, nonce, callback, binding: digest(browserBinding), expiresAt: this.now() + 300000 });
    return client.buildAuthorizationUrl(config, { redirect_uri: callback, scope: 'openid profile email', code_challenge: codeChallenge, code_challenge_method: 'S256', state, nonce });
  }

  async complete(callbackUrl: URL, browserBinding: string): Promise<{ issuer: string; subject: string }> {
    this.cleanup();
    const stateValues = callbackUrl.searchParams.getAll('state');
    const state = stateValues.length === 1 ? stateValues[0] : undefined;
    const flow = state ? this.flows.get(state) : undefined;
    const callback = `${callbackUrl.origin}${callbackUrl.pathname}`;
    if (!state || !flow || !this.callbacks.has(callback) || flow.callback !== callback || !timingSafeEqual(flow.binding, digest(browserBinding))) throw new Error('Invalid OIDC flow');
    // Consume before dispatch so concurrent callbacks cannot exchange twice.
    this.flows.delete(state);
    try {
      const tokens = await client.authorizationCodeGrant(await this.config(), callbackUrl, { pkceCodeVerifier: flow.verifier, expectedState: state, expectedNonce: flow.nonce, idTokenExpected: true });
      const claims = tokens.claims();
      if (!claims?.sub || claims.iss !== this.issuer.href || claims.sub.length > 512) throw new Error('Invalid identity');
      // Access and refresh tokens never leave this server-side boundary.
      return { issuer: claims.iss, subject: claims.sub };
    } catch {
      throw new Error('OIDC authentication failed');
    }
  }
}
