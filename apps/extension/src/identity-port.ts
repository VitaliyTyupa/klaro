import type { IdentityPort } from './auth';

type BrowserGlobals = typeof globalThis & {
  chrome?: { identity?: IdentityPort };
  browser?: { identity?: IdentityPort };
};

export function browserIdentity(): IdentityPort | undefined {
  const browser = globalThis as BrowserGlobals;
  return browser.browser?.identity ?? browser.chrome?.identity;
}
