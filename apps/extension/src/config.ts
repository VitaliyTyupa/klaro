const configured = (globalThis as { KLARO_BACKEND_ORIGIN?: unknown }).KLARO_BACKEND_ORIGIN ?? 'https://klaro.example';
if (typeof configured !== 'string') throw new Error('Invalid packaged backend');
const url = new URL(configured);
if (url.origin !== configured || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Invalid packaged backend');
export const BACKEND_ORIGIN = url.origin;
