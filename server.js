import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, 'dist');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'mederror_data.json');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const STAFF_PIN = (process.env.STAFF_PIN || '').trim();

function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });
}

let lastServerSnapshotAt = 0;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];

  // Health & config check for cloud deployments
  if (reqPath === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      hasPin: Boolean(STAFF_PIN),
      dataExists: fs.existsSync(DATA_FILE),
      serverTime: new Date().toISOString()
    }));
    return;
  }

  // Optional Staff PIN verification when STAFF_PIN env var is set
  if (reqPath === '/api/verify-pin' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const valid = !STAFF_PIN || parsed.pin === STAFF_PIN;
        res.writeHead(valid ? 200 : 401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: valid }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  // Auto-save REST endpoints for local/cloud disk persistence
  if (reqPath === '/api/data') {
    ensureDataDirs();
    if (req.method === 'GET') {
      if (!fs.existsSync(DATA_FILE)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, data: null }));
        return;
      }
      fs.readFile(DATA_FILE, 'utf8', (err, raw) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false }));
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, data: parsed }));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, data: null }));
        }
      });
      return;
    }

    if (req.method === 'POST') {
      if (STAFF_PIN && req.headers['x-staff-pin'] !== STAFF_PIN) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'PIN ไม่ถูกต้อง' }));
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2), 'utf8');

          // Auto-save a dated snapshot file on disk at most every 5 minutes
          const now = Date.now();
          if (now - lastServerSnapshotAt > 5 * 60 * 1000) {
            lastServerSnapshotAt = now;
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            fs.writeFileSync(path.join(SNAP_DIR, `backup_${stamp}.json`), JSON.stringify(parsed, null, 2), 'utf8');
            const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json')).sort();
            while (files.length > 30) {
              fs.unlinkSync(path.join(SNAP_DIR, files.shift()));
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, savedAt: new Date().toISOString() }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false }));
        }
      });
      return;
    }
  }

  if (reqPath === '/') reqPath = '/index.html';
  
  let filePath = path.join(DIST_DIR, reqPath);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server Error');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log('\n======================================================');
  console.log(` ระบบห้องยา Mederror เปิดทำงานสำเร็จที่:`);
  console.log(` http://localhost:${PORT}`);
  console.log(` โหมดผู้บริหาร (ดูอย่างเดียว): http://localhost:${PORT}/?mode=executive`);
  if (STAFF_PIN) console.log(' [Security] เปิดใช้งาน STAFF_PIN สำหรับการแก้ไขข้อมูล');
  console.log('======================================================\n');

  // Automatically open default browser on local Windows desktop only
  if (process.platform === 'win32' && !process.env.PORT && !process.env.NO_BROWSER) {
    exec(`start http://localhost:${PORT}`);
  }
});
