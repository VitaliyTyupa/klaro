import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Body, Controller, Get, HttpCode, Post, Req, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { OidcService } from './oidc';
import { HandoffService } from './handoff';
import { SessionService, type AuthenticatedSession } from './sessions';

const appOrigin = process.env['APP_ORIGIN'] ?? 'http://localhost:4200';
const originUrl = new URL(appOrigin);
if ((process.env['NODE_ENV'] === 'production' && originUrl.protocol !== 'https:') || originUrl.origin !== appOrigin || (originUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(originUrl.hostname))) throw new Error('Invalid application origin');
const secure = originUrl.protocol === 'https:';
const sessionCookie = secure ? '__Host-klaro_session' : 'klaro_session';
const csrfCookie = secure ? '__Host-klaro_csrf' : 'klaro_csrf';
const bindingCookie = secure ? '__Secure-klaro_oidc' : 'klaro_oidc';
const callback = `${appOrigin}/auth/callback`;
const extensionCallback = `${appOrigin}/auth/extension/callback`;
const extensionRedirects = new Set((process.env['EXTENSION_CALLBACKS'] ?? '').split(',').filter(Boolean).map(value => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid extension callback');
  return url.href;
}));
const extensionFlows = new Map<string, { redirect: string; challenge: string; expiresAt: number }>();
const handoffs = new HandoffService();
export const sessions = new SessionService(process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro');
let oidc: OidcService | undefined;

function getOidc(): OidcService {
  const issuer = process.env['OIDC_ISSUER'];
  const clientId = process.env['OIDC_CLIENT_ID'];
  if (!issuer || !clientId) throw new ServiceUnavailableException({ code: 'unavailable', retryable: false });
  oidc ??= new OidcService({ issuer, clientId, clientSecret: process.env['OIDC_CLIENT_SECRET'], callbacks: [callback, extensionCallback], allowLoopbackHttp: process.env['OIDC_ALLOW_LOOPBACK_HTTP'] === 'true' && process.env['NODE_ENV'] !== 'production' });
  return oidc;
}

function cookie(request: IncomingMessage, name: string): string {
  const matches = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (matches.length !== 1) return '';
  const value = matches[0]?.slice(name.length + 1) ?? '';
  return value.length <= 128 ? value : '';
}

function serializedCookie(name: string, value: string, maxAge: number, httpOnly: boolean, path = '/'): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}${secure ? '; Secure' : ''}`;
}

export async function authenticateWeb(request: IncomingMessage, mutation = false): Promise<AuthenticatedSession> {
  const session = await sessions.authenticate(cookie(request, sessionCookie), 'web');
  if (!session) throw new UnauthorizedException({ code: 'unauthenticated', retryable: false });
  const csrfHeader = request.headers['x-csrf-token'];
  if (mutation && (request.headers.origin !== appOrigin || typeof csrfHeader !== 'string' || !sessions.validateCsrf(session, csrfHeader))) throw new UnauthorizedException({ code: 'forbidden', retryable: false });
  return session;
}

export async function authenticateRequest(request: IncomingMessage, mutation = false): Promise<AuthenticatedSession> {
  const header = request.headers.authorization;
  if (header !== undefined) {
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw new UnauthorizedException({ code: 'unauthenticated', retryable: false });
    const session = await sessions.authenticate(header.slice(7), 'extension');
    if (!session) throw new UnauthorizedException({ code: 'unauthenticated', retryable: false });
    return session;
  }
  return authenticateWeb(request, mutation);
}

@Controller('auth')
export class IdentityController {
  @Get('login')
  async login(@Res() response: ServerResponse): Promise<void> {
    const binding = randomBytes(32).toString('base64url');
    const location = await getOidc().begin(callback, binding);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', serializedCookie(bindingCookie, binding, 300, true, '/auth'));
    response.writeHead(302, { Location: location.href });
    response.end();
  }

  @Get('callback')
  async callback(@Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    try {
      const identity = await getOidc().complete(new URL(request.url ?? '', appOrigin), cookie(request, bindingCookie));
      const session = await sessions.signIn(identity);
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Set-Cookie', [serializedCookie(bindingCookie, '', 0, true, '/auth'), serializedCookie(sessionCookie, session.token, 28800, true), serializedCookie(csrfCookie, session.csrfToken, 28800, false)]);
      response.writeHead(302, { Location: appOrigin });
      response.end();
    } catch {
      throw new UnauthorizedException({ code: 'unauthenticated', retryable: false });
    }
  }

  @Get('extension/login')
  async extensionLogin(@Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '', appOrigin);
    const redirect = url.searchParams.get('redirectUri') ?? '';
    const challenge = url.searchParams.get('codeChallenge') ?? '';
    if (!extensionRedirects.has(redirect) || !/^[a-zA-Z0-9_-]{43}$/.test(challenge)) throw new UnauthorizedException({ code: 'forbidden', retryable: false });
    for (const [state, flow] of extensionFlows) if (flow.expiresAt <= Date.now()) extensionFlows.delete(state);
    if (extensionFlows.size >= 1000) throw new ServiceUnavailableException({ code: 'unavailable', retryable: true });
    const binding = randomBytes(32).toString('base64url');
    const location = await getOidc().begin(extensionCallback, binding);
    const state = location.searchParams.get('state');
    if (!state) throw new ServiceUnavailableException({ code: 'unavailable', retryable: true });
    extensionFlows.set(state, { redirect, challenge, expiresAt: Date.now() + 300000 });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', serializedCookie(bindingCookie, binding, 300, true, '/auth'));
    response.writeHead(302, { Location: location.href });
    response.end();
  }

  @Get('extension/callback')
  async extensionCallback(@Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? '', appOrigin);
      const state = url.searchParams.get('state') ?? '';
      const flow = extensionFlows.get(state);
      extensionFlows.delete(state);
      if (!flow || flow.expiresAt <= Date.now()) throw new Error('Expired flow');
      const identity = await getOidc().complete(url, cookie(request, bindingCookie));
      const session = await sessions.signIn(identity, 'extension');
      const code = handoffs.issue(flow.challenge, session.token, session.expiresAt);
      const location = new URL(flow.redirect);
      location.searchParams.set('code', code);
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Set-Cookie', serializedCookie(bindingCookie, '', 0, true, '/auth'));
      response.writeHead(302, { Location: location.href });
      response.end();
    } catch { throw new UnauthorizedException({ code: 'unauthenticated', retryable: false }); }
  }

  @Post('extension/exchange')
  @HttpCode(200)
  exchange(@Body() body: unknown, @Res() response: ServerResponse): void {
    try {
      if (!body || typeof body !== 'object' || Object.keys(body).sort().join(',') !== 'code,verifier' || !('code' in body) || !('verifier' in body) || typeof body.code !== 'string' || typeof body.verifier !== 'string') throw new Error('Invalid body');
      const result = handoffs.exchange(body.code, body.verifier);
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(result));
    } catch { throw new UnauthorizedException({ code: 'unauthenticated', retryable: false }); }
  }

  @Post('extension/logout')
  async extensionLogout(@Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    const header = request.headers.authorization;
    const session = typeof header === 'string' && header.startsWith('Bearer ') ? await sessions.authenticate(header.slice(7), 'extension') : undefined;
    if (!session) throw new UnauthorizedException({ code: 'unauthenticated', retryable: false });
    await sessions.revoke(session);
    response.setHeader('Cache-Control', 'no-store');
    response.writeHead(204);
    response.end();
  }

  @Get('session')
  async current(@Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    const session = await authenticateWeb(request);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ userId: session.userId }));
  }

  @Post('logout')
  async logout(@Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    await sessions.revoke(await authenticateWeb(request, true));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', [serializedCookie(sessionCookie, '', 0, true), serializedCookie(csrfCookie, '', 0, false)]);
    response.writeHead(204);
    response.end();
  }
}
