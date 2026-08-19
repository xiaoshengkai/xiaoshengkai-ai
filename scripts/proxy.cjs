const http = require('http');
const httpProxy = require('http-proxy');
const fs = require('fs');
const path = require('path');

const config = require('../config/network.json');
const LOCAL = config.hosts.local;
const PROD_DIRECT = config.ports.aiChat.prodDirect;
const PROXY_PORT = config.ports.aiChat.prodProxy;

const proxy = httpProxy.createProxyServer({
  target: `http://${LOCAL}:${PROD_DIRECT}`,
  xfwd: true,
});

const SITE_DIR = path.join(__dirname, '..', 'site');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = req.url.replace(/^\//, '');
  try { urlPath = decodeURIComponent(urlPath); } catch {}
  if (!urlPath) urlPath = 'index.html';
  let filePath = path.join(SITE_DIR, urlPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp3', '.mp4'].includes(ext)) {
      headers['Cache-Control'] = 'public, max-age=1800, immutable';
    } else if (ext === '.html' || ext === '.css' || ext === '.js') {
      headers['Cache-Control'] = 'no-cache';
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 Not Found</h1>');
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/ai') || req.url.startsWith('/note/') || req.url.startsWith('/preview/') || req.url.startsWith('/api/') || req.url.startsWith('/workflow') || req.url.startsWith('/memory') || req.url.startsWith('/schedule') || req.url.startsWith('/settings') || req.url.startsWith('/tools')) {
    if (!req.url.startsWith('/ai')) {
      req.url = '/ai' + req.url;
    }
    proxy.web(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PROXY_PORT, () => {
  console.log(`代理已启动 → http://${LOCAL}:${PROXY_PORT}`);
  console.log('  /             → 博客 (site/)');
  console.log(`  /ai/ /note/ /preview/ /api/ → AI 工作台 (${LOCAL}:${PROD_DIRECT})`);
});