// 桌面版入口:内嵌静态服务器 + 无边框游戏窗口
// 运行: npm install && npm start   打包: npm run dist
const { app, BrowserWindow, globalShortcut } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

// ES 模块在 file:// 下会被 CORS 拦截,所以内嵌一个只监听本机的静态服务器
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (p === '/') p = '/index.html';
      const file = path.normalize(path.join(ROOT, p));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

app.whenReady().then(async () => {
  const port = await serve();
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    title: '侠盗猎马人:中世纪王国',
    backgroundColor: '#0a0614',
    autoHideMenuBar: true,
    fullscreenable: true,
  });
  win.loadURL(`http://127.0.0.1:${port}/index.html`);
  // F11 全屏
  globalShortcut.register('F11', () => win.setFullScreen(!win.isFullScreen()));
});

app.on('window-all-closed', () => app.quit());
