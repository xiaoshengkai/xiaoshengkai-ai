import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { URL } from "node:url";

const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), "Downloads");

const RESOURCE_TAGS = [
  { selector: 'link[href]', attr: 'href' },
  { selector: 'script[src]', attr: 'src' },
  { selector: 'img[src]', attr: 'src' },
  { selector: 'source[src]', attr: 'src' },
  { selector: 'source[srcset]', attr: 'srcset' },
  { selector: 'video[src]', attr: 'src' },
  { selector: 'audio[src]', attr: 'src' },
];

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp']);
const FONT_EXTS = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot']);

function resolveUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href.split('?')[0].split('#')[0];
  } catch {
    return null;
  }
}

function isSameDomain(url1, url2) {
  try {
    return new URL(url1).hostname === new URL(url2).hostname;
  } catch {
    return false;
  }
}

function getLocalPath(url, rootDir) {
  const parsed = new URL(url);
  let filePath = parsed.pathname.replace(/[\\/:*?"<>|]/g, '_');
  if (filePath.endsWith('/')) filePath += 'index.html';
  return path.join(rootDir, parsed.hostname, filePath);
}

function getBaseUrl(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
}

async function downloadResource(url, localPath, cookies) {
  if (fs.existsSync(localPath)) return 'skipped';
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: 50 * 1024 * 1024,
    headers: cookies ? { Cookie: cookies } : {},
  });
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, Buffer.from(response.data));
  return 'downloaded';
}

function categorizeExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'images';
  if (FONT_EXTS.has(ext)) return 'fonts';
  if (ext === '.css') return 'css';
  if (ext === '.js') return 'js';
  return 'other';
}

function extractPageContent($, url) {
  const title = $('title').text().trim();
  const description = $('meta[name="description"]').attr('content') || '';

  const baseUrl = getBaseUrl(url);

  // 1. 先提取链接和资源（DOM 未修改）
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const absolute = resolveUrl(href, baseUrl);
    if (absolute) {
      const text = $(el).text().trim().slice(0, 80);
      links.push({ url: absolute, text: text || absolute });
    }
  });

  const resources = {};
  for (const { selector, attr } of RESOURCE_TAGS) {
    $(selector).each((_, el) => {
      const val = $(el).attr(attr);
      if (!val || val.startsWith('data:') || val.startsWith('#')) return;
      const urls = attr === 'srcset'
        ? val.split(',').map(s => s.trim().split(' ')[0])
        : [val];
      for (const u of urls) {
        const absolute = resolveUrl(u, baseUrl);
        if (absolute) {
          const cat = categorizeExt(getLocalPath(absolute, ''));
          if (!resources[cat]) resources[cat] = [];
          if (!resources[cat].includes(absolute)) resources[cat].push(absolute);
        }
      }
    });
  }

  // 2. 再提取正文（移除无关元素）
  $('script, style, nav, footer, header, iframe, noscript').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 5000);

  return { title, description, bodyText, resources, links };
}

async function fetchPageImpl(url, rootDir, cookies) {
  const stats = { html: 0, css: 0, js: 0, images: 0, fonts: 0, other: 0, errors: [] };

const response = await axios.get(url, {
          responseType: 'text',
          timeout: 30000,
          maxRedirects: 5,
          headers: cookies ? { Cookie: cookies } : {},
        });
  const html = response.data;
  const $ = cheerio.load(html);

  const htmlPath = getLocalPath(url, rootDir);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);
  stats.html = 1;

  const resources = new Set();
  const baseUrl = getBaseUrl(url);

  for (const { selector, attr } of RESOURCE_TAGS) {
    $(selector).each((_, el) => {
      const val = $(el).attr(attr);
      if (!val || val.startsWith('data:') || val.startsWith('#')) return;
      const urls = attr === 'srcset'
        ? val.split(',').map(s => s.trim().split(' ')[0])
        : [val];
      for (const u of urls) {
        const absolute = resolveUrl(u, baseUrl);
        if (absolute) resources.add(absolute);
      }
    });
  }

  for (const resourceUrl of resources) {
    try {
      const localPath = getLocalPath(resourceUrl, rootDir);
      const result = await downloadResource(resourceUrl, localPath, cookies);
      if (result === 'downloaded') {
        const cat = categorizeExt(localPath);
        stats[cat]++;
      }
    } catch (err) {
      stats.errors.push(`${resourceUrl}: ${err.message}`);
    }
  }

  return stats;
}

async function crawlSiteImpl(startUrl, rootDir, maxDepth = 3, maxPages = 50, cookies) {
  const visited = new Set();
  const queue = [{ url: startUrl, depth: 0 }];
  const stats = { pages: 0, html: 0, css: 0, js: 0, images: 0, fonts: 0, other: 0, errors: [] };
  const CONCURRENCY = 3;

  while (queue.length > 0 && stats.pages < maxPages) {
    const batch = [];
    for (let i = 0; i < CONCURRENCY && queue.length > 0 && stats.pages + batch.length < maxPages; i++) {
      const item = queue.shift();
      if (!item) break;
      if (item.depth > maxDepth) continue;
      if (visited.has(item.url)) continue;
      visited.add(item.url);
      batch.push(item);
    }
    if (batch.length === 0) break;

    const results = await Promise.allSettled(
      batch.map(async ({ url, depth }) => {
        const response = await axios.get(url, {
          responseType: 'text',
          timeout: 30000,
          maxRedirects: 5,
        });
        const html = response.data;
        const $ = cheerio.load(html);

        const htmlPath = getLocalPath(url, rootDir);
        fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
        fs.writeFileSync(htmlPath, html);

        const resources = new Set();
        const links = new Set();
        const baseUrl = getBaseUrl(url);

        for (const { selector, attr } of RESOURCE_TAGS) {
          $(selector).each((_, el) => {
            const val = $(el).attr(attr);
            if (!val || val.startsWith('data:') || val.startsWith('#')) return;
            const urls = attr === 'srcset'
              ? val.split(',').map(s => s.trim().split(' ')[0])
              : [val];
            for (const u of urls) {
              const absolute = resolveUrl(u, baseUrl);
              if (absolute) resources.add(absolute);
            }
          });
        }

        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
          const absolute = resolveUrl(href, baseUrl);
          if (absolute && isSameDomain(absolute, startUrl) && !visited.has(absolute)) {
            links.add(absolute);
          }
        });

        return { url, depth, resources, links };
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        stats.errors.push(result.reason.message);
        continue;
      }

      const { url, depth, resources, links } = result.value;
      stats.pages++;
      stats.html++;

      for (const resourceUrl of resources) {
        try {
          const localPath = getLocalPath(resourceUrl, rootDir);
          const dlResult = await downloadResource(resourceUrl, localPath, cookies);
          if (dlResult === 'downloaded') {
            const cat = categorizeExt(localPath);
            stats[cat]++;
          }
        } catch (err) {
          stats.errors.push(`${resourceUrl}: ${err.message}`);
        }
      }

      for (const link of links) {
        if (!visited.has(link) && depth + 1 <= maxDepth) {
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    }
  }

  return stats;
}

async function crawlSiteFetch(startUrl, maxDepth = 3, maxPages = 50, cookies) {
  const visited = new Set();
  const queue = [{ url: startUrl, depth: 0 }];
  const pages = [];
  const CONCURRENCY = 3;

  while (queue.length > 0 && pages.length < maxPages) {
    const batch = [];
    for (let i = 0; i < CONCURRENCY && queue.length > 0 && pages.length + batch.length < maxPages; i++) {
      const item = queue.shift();
      if (!item) break;
      if (item.depth > maxDepth) continue;
      if (visited.has(item.url)) continue;
      visited.add(item.url);
      batch.push(item);
    }
    if (batch.length === 0) break;

    const results = await Promise.allSettled(
      batch.map(async ({ url, depth }) => {
        const response = await axios.get(url, {
          responseType: 'text',
          timeout: 30000,
          maxRedirects: 5,
        });
        const $ = cheerio.load(response.data);
        const content = extractPageContent($, url);
        const links = content.links.map(l => l.url);
        return { url, depth, content, links };
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        pages.push({ url: '', title: '', error: result.reason.message });
        continue;
      }

      const { url, depth, content, links } = result.value;
      pages.push({ url, title: content.title, description: content.description });

      for (const link of links) {
        if (!visited.has(link) && depth + 1 <= maxDepth) {
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    }
  }

  return pages;
}

function detectLoginPage(html) {
  return /login|sign.?in|password|请输入密码|Log in|Sign in/i.test(html) ||
         /<input[^>]*type=["']password["']/.test(html);
}

export function register(server) {
  server.tool(
    "fetchPage",
    "获取网页内容。download=true 时下载到本地（默认 ~/Downloads），download=false 时只返回文本。需要登录的页面请提供 cookies",
    {
      url: z.string().describe("要获取的网页地址"),
      download: z.boolean().optional().default(false).describe("是否下载到本地，默认 false"),
      rootDir: z.string().optional().describe("下载目录，默认 ~/Downloads"),
      cookies: z.string().optional().describe("Cookie 字符串，用于需要登录的页面"),
    },
    async ({ url, download, rootDir, cookies }) => {
      try {
        console.error(`[fetch:fetchPage] url=${url} download=${download} cookies=${!!cookies}`);
        if (download) {
          const dir = rootDir || DEFAULT_DOWNLOAD_DIR;
          const stats = await fetchPageImpl(url, dir, cookies);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                ok: true,
                mode: "download",
                stats: {
                  html: stats.html,
                  css: stats.css,
                  js: stats.js,
                  images: stats.images,
                  fonts: stats.fonts,
                  other: stats.other,
                },
                errors: stats.errors,
                rootDir: path.join(dir, new URL(url).hostname),
              }, null, 2),
            }],
          };
        }

        const response = await axios.get(url, {
          responseType: 'text',
          timeout: 30000,
          maxRedirects: 5,
          headers: cookies ? { Cookie: cookies } : {},
        });
        const $ = cheerio.load(response.data);
        const content = extractPageContent($, url);
        const warning = detectLoginPage(response.data) ? "页面可能需要登录，请提供 Cookie 后重试" : undefined;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              mode: "fetch",
              url,
              title: content.title,
              description: content.description,
              bodyText: content.bodyText,
              resources: {
                css: (content.resources.css || []).length,
                js: (content.resources.js || []).length,
                images: (content.resources.images || []).length,
                fonts: (content.resources.fonts || []).length,
                other: (content.resources.other || []).length,
              },
              links: content.links.slice(0, 30),
              warning,
            }, null, 2),
          }],
        };
      } catch (err) {
        console.error(`[fetch:fetchPage] FAILED url=${url}: ${err.message}`);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }) }],
        };
      }
    },
  );

  server.tool(
    "crawlSite",
    "爬取网站页面。download=true 时下载整站到本地（默认 ~/Downloads），download=false 时只返回 URL 列表。需要登录的页面请提供 cookies",
    {
      url: z.string().describe("起始网站地址"),
      download: z.boolean().optional().default(false).describe("是否下载到本地，默认 false"),
      rootDir: z.string().optional().describe("下载目录，默认 ~/Downloads"),
      maxDepth: z.number().optional().default(3).describe("最大爬取深度，默认 3"),
      maxPages: z.number().optional().default(50).describe("最大页面数，默认 50"),
      cookies: z.string().optional().describe("Cookie 字符串，用于需要登录的页面"),
    },
    async ({ url, download, rootDir, maxDepth, maxPages, cookies }) => {
      try {
        console.error(`[fetch:crawlSite] url=${url} download=${download} maxDepth=${maxDepth} maxPages=${maxPages}`);
        if (download) {
          const dir = rootDir || DEFAULT_DOWNLOAD_DIR;
          const stats = await crawlSiteImpl(url, dir, maxDepth, maxPages, cookies);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                ok: true,
                mode: "download",
                stats: {
                  pages: stats.pages,
                  html: stats.html,
                  css: stats.css,
                  js: stats.js,
                  images: stats.images,
                  fonts: stats.fonts,
                  other: stats.other,
                },
                errors: stats.errors,
                rootDir: path.join(dir, new URL(url).hostname),
              }, null, 2),
            }],
          };
        }

        const pages = await crawlSiteFetch(url, maxDepth, maxPages, cookies);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              mode: "fetch",
              url,
              totalPages: pages.length,
              pages,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }) }],
        };
      }
    },
  );
}