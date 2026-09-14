const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, {Allow: 'GET, HEAD'}).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  if (pathname === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({status: 'ok', revision: process.env.DEPLOY_REVISION || 'local'}));
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  // Only publish the page and its assets, never repository files or server code.
  if (pathname !== '/index.html' && !/^\/assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(css|js|ttf|txt)$/.test(pathname)) {
    res.writeHead(404).end(); return;
  }
  const filename = path.resolve(root, '.' + pathname);
  fs.readFile(filename, (error, body) => {
    res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : error ? 'Not found' : body);
  });
});
if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
module.exports = server;
