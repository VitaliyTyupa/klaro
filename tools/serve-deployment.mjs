import { createServer as httpServer, request as upstreamRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const errorBody = JSON.stringify({ code: 'unavailable', retryable: true });
export async function createDeploymentServer({ root = resolve('dist/web/browser'), upstream = 'http://127.0.0.1:3000', tls, log = console.info } = {}) {
  const destination = new URL(upstream); if (destination.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(destination.hostname)) throw new Error('Backend must share the local network namespace');
  const handler = async (request, response) => {
    const start = performance.now(); response.on('finish', () => log(JSON.stringify({ event: 'proxy-request', status: response.statusCode, durationMs: Math.round(performance.now() - start) })));
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    if (tls) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const failed = status => { if (response.headersSent) { response.destroy(); return; } response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(errorBody); };
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (/^\/(?:v1|auth|health|socket\.io)(?:\/|$)/.test(path)) {
        const forwarded = upstreamRequest({ hostname: destination.hostname, port: destination.port, path: request.url, method: request.method, headers: { ...request.headers, host: request.headers.host } }, reply => { response.writeHead(reply.statusCode ?? 502, reply.headers); reply.pipe(response); });
        let size = 0; request.on('data', chunk => { size += chunk.length; if (size > 1048576) { forwarded.destroy(); failed(413); request.resume(); } });
        forwarded.on('error', () => failed(502)); request.on('aborted', () => forwarded.destroy()); forwarded.setTimeout(250000, () => forwarded.destroy()); request.pipe(forwarded); return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { failed(405); return; }
      const decoded = decodeURIComponent(path); const file = extname(decoded) ? resolve(root, `.${decoded}`) : resolve(root, 'index.html');
      if (!file.startsWith(`${resolve(root)}/`) || !mime[extname(file)]) { failed(404); return; }
      response.setHeader('Content-Type', mime[extname(file)]); response.setHeader('Cache-Control', extname(file) === '.html' ? 'no-store' : 'public, max-age=3600');
      const content = await readFile(file); response.end(request.method === 'HEAD' ? undefined : content);
    } catch { failed(404); }
  };
  const server = tls ? httpsServer(tls, handler) : httpServer(handler);
  server.requestTimeout = 250000; server.headersTimeout = 10000;
  server.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith('/socket.io/')) { socket.destroy(); return; }
    const upstream = connect(Number(destination.port || 80), destination.hostname, () => {
      upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${Object.entries(request.headers).map(([key,value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
  });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const tls = process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE ? { cert: await readFile(process.env.TLS_CERT_FILE), key: await readFile(process.env.TLS_KEY_FILE) } : undefined;
    if (process.env.NODE_ENV === 'production' && !tls) throw new Error('Production requires TLS');
    const server = await createDeploymentServer({ tls }); server.listen(Number(process.env.PUBLIC_PORT ?? 8080), process.env.PUBLIC_HOST ?? '127.0.0.1');
  } catch { console.error(JSON.stringify({ event: 'proxy-startup-failed' })); process.exitCode = 1; }
}
