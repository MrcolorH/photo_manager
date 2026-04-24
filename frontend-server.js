/**
 * 前端静态文件服务器 (端口 9900)
 * 
 * - 服务前端构建产物 (frontend/dist/)
 * - 将 /api/* 和 /uploads/* 代理到后端 (端口 9901)
 * - SPA fallback: 非文件路由返回 index.html
 * 
 * 仅使用 Node.js 内置模块，无需额外依赖
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND_PORT = 9900;
const BACKEND_PORT = 9901;

// 前端文件根目录
const FRONTEND_DIR = path.join(__dirname, 'frontend', 'dist');

// MIME 类型映射
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function serveStaticFile(res, filePath) {
  const contentType = getContentType(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(data);
  });
}

function proxyToBackend(clientReq, clientRes) {
  const options = {
    hostname: 'localhost',
    port: BACKEND_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers, host: `localhost:${BACKEND_PORT}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', (err) => {
    console.error(`[前端] 代理请求失败: ${err.message}`);
    clientRes.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    clientRes.end(JSON.stringify({ error: '后端服务不可用' }));
  });

  clientReq.pipe(proxyReq);
}

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  console.log(`[前端] ${req.method} ${req.url}`);

  // API 请求代理到后端
  if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) {
    proxyToBackend(req, res);
    return;
  }

  // 静态文件服务
  let filePath;
  if (req.url === '/' || req.url === '') {
    filePath = path.join(FRONTEND_DIR, 'index.html');
  } else {
    // 移除 query string
    const cleanPath = req.url.split('?')[0];
    filePath = path.join(FRONTEND_DIR, cleanPath);
  }

  // 安全检查：防止目录遍历
  const normalizedPath = path.normalize(filePath);
  if (!normalizedPath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // 检查文件是否存在，不存在则 SPA fallback
  fs.stat(normalizedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA fallback: 返回 index.html
      filePath = path.join(FRONTEND_DIR, 'index.html');
    }
    serveStaticFile(res, filePath);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[前端] 错误: 端口 ${FRONTEND_PORT} 已被占用`);
    console.error('[前端] 请先关闭占用该端口的程序后重试');
    process.exit(1);
  } else {
    console.error(`[前端] 服务器错误: ${err.message}`);
    process.exit(1);
  }
});

server.listen(FRONTEND_PORT, () => {
  console.log(`[前端] 前端服务运行在 http://localhost:${FRONTEND_PORT}`);
  console.log(`[前端] API 代理到 http://localhost:${BACKEND_PORT}`);
});
