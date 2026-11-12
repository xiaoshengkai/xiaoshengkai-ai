const http = require('http');
const httpProxy = require('http-proxy');
const fs = require('fs');
const path = require('path');

// 加载根 .env（AUTH_SECRET 等；dotenv 不覆盖已存在的 env）
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = require('../config/network.json');
const LOCAL = config.hosts.local;
const PROD_DIRECT = config.ports.aiChat.prodDirect;
const PROXY_PORT = config.ports.aiChat.prodProxy;

const proxy = httpProxy.createProxyServer({
  target: `http://${LOCAL}:${PROD_DIRECT}`,
  xfwd: true,
});

// 上游（next）重启窗口期连接被拒时不得崩进程：返回 502 保公网入口存活
proxy.on('error', (err, req, res) => {
  console.error(`[proxy] upstream error: ${err.message}`);
  if (res && typeof res.writeHead === 'function') {
    try {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('upstream unavailable');
    } catch {}
  }
});

const SITE_DIR = path.join(__dirname, '..', 'site');

// ── 访问控制：读 data/settings/auth-paths.json（2s 缓存，fresh-read）──
let _authPathsCache = { at: 0, val: [] };
function readProtectedPaths() {
  const now = Date.now();
  if (now - _authPathsCache.at < 2000) return _authPathsCache.val;
  let list = [];
  try {
    const p = path.join(__dirname, '..', 'data', 'settings', 'auth-paths.json');
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(parsed && parsed.protected)) {
        list = parsed.protected.map((s) => String(s).trim()).filter(Boolean);
      }
    }
  } catch {
    /* 读取失败 → 不保护任何路径 */
  }
  _authPathsCache = { at: now, val: list };
  return list;
}

function normalizePrefix(s) {
  let p = String(s || '').trim();
  if (!p.startsWith('/')) p = '/' + p;
  return p.replace(/\/+$/, '');
}

function isProtectedPath(urlPath) {
  for (const raw of readProtectedPaths()) {
    const prefix = normalizePrefix(raw);
    if (!prefix) continue;
    if (urlPath === prefix || urlPath.startsWith(prefix + '/')) return true;
  }
  return false;
}

// ── 鉴权：动态 import @app/shared/auth.js（ESM）──
let authPromise = null;
function loadAuth() {
  if (!authPromise) {
    authPromise = import(path.join(__dirname, '..', 'packages', 'shared', 'auth.js')).catch((err) => {
      console.error('[proxy] auth.js 加载失败:', err && err.message);
      return null;
    });
  }
  return authPromise;
}

function parseCookie(header, name) {
  if (!header) return '';
  const m = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : '';
}

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
  let filePath = path.resolve(SITE_DIR, urlPath);
  // 防路径穿越：resolve 后必须仍在 site/ 内（否则 /../.env 可读出全部密钥）
  if (filePath !== SITE_DIR && !filePath.startsWith(SITE_DIR + path.sep)) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    return res.end('<h1>404 Not Found</h1>');
  }
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

const PROXY_PREFIXES = ['/ai', '/note/', '/preview/', '/api/', '/workflow', '/memory', '/schedule', '/logs', '/settings', '/m/'];

function isProxyPath(url) {
  return PROXY_PREFIXES.some((p) => url.startsWith(p));
}

const server = http.createServer(async (req, res) => {
  if (isProxyPath(req.url)) {
    if (!req.url.startsWith('/ai')) {
      req.url = '/ai' + req.url;
    }
    proxy.web(req, res);
    return;
  }

  // 博客侧：命中「需登录路径」→ 校验 Cookie，无效跳登录（带 next 回跳）
  if (isProtectedPath(req.url.split('?')[0])) {
    const auth = await loadAuth();
    if (auth && auth.isAuthConfigured()) {
      const token = parseCookie(req.headers.cookie, 'ai_session');
      if (!auth.verifyToken(token, process.env.AUTH_SECRET || '')) {
        res.writeHead(302, { Location: '/ai/login?next=' + encodeURIComponent(req.url) });
        return res.end();
      }
    }
  }

  serveStatic(req, res);
});

// 默认只绑回环（funnel 经 tailscaled 本机转发）；直连公网部署用 PROXY_BIND=0.0.0.0 启动
const BIND = process.env.PROXY_BIND || LOCAL;

server.listen(PROXY_PORT, BIND, () => {
  console.log(`代理已启动 → http://${BIND}:${PROXY_PORT}`);
  console.log(`代理已启动 → http://${LOCAL}:${PROXY_PORT}`);
  console.log('  /             → 博客 (site/)');
  console.log(`  /ai/ /note/ /preview/ /api/ → AI 工作台 (${LOCAL}:${PROD_DIRECT})`);
});
