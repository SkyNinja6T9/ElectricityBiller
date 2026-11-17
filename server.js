const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 1. Simple zero-dependency .env loader
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    });
  }
} catch (e) {
  console.warn('Could not read .env file:', e.message);
}

const PORT = parseInt(process.env.PORT, 10) || 3000;

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// 2. Helper to decorate res to match Vercel Serverless Function signature
function decorateResponse(res) {
  res.status = function(code) {
    res.statusCode = code;
    return res;
  };
  res.json = function(data) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = function(data) {
    res.end(data);
    return res;
  };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  decorateResponse(res);

  // 3. API Routes Handling (Vercel serverless function emulation)
  if (pathname.startsWith('/api/')) {
    const apiRoute = pathname.replace(/^\/api\//, '').replace(/\.js$/, '');
    const apiFilePath = path.join(__dirname, 'api', `${apiRoute}.js`);

    if (fs.existsSync(apiFilePath)) {
      // Collect request body
      let bodyData = '';
      req.on('data', chunk => {
        bodyData += chunk;
      });

      req.on('end', async () => {
        if (bodyData) {
          try {
            req.body = JSON.parse(bodyData);
          } catch (e) {
            req.body = bodyData;
          }
        } else {
          req.body = {};
        }

        try {
          // Clear require cache for fast dev reload
          delete require.cache[require.resolve(apiFilePath)];
          const handler = require(apiFilePath);
          await handler(req, res);
        } catch (apiErr) {
          console.error(`Error in /api/${apiRoute}:`, apiErr);
          if (!res.writableEnded) {
            res.status(500).json({ error: 'Internal Server Error', message: apiErr.message });
          }
        }
      });
      return;
    } else {
      return res.status(404).json({ error: 'API route not found' });
    }
  }

  // 4. Static File Serving
  if (pathname === '/') {
    pathname = '/index.html';
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(__dirname, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Check in public/
      const publicFilePath = path.join(__dirname, 'public', safePath);
      fs.stat(publicFilePath, (pErr, pStats) => {
        if (pErr || !pStats.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }
        serveFile(publicFilePath, res);
      });
      return;
    }
    serveFile(filePath, res);
  });
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 Internal Error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`⚡ Electricity Bill Splitter WebApp`);
  console.log(`🚀 Server running at: http://localhost:${PORT}`);
  console.log(`🔒 Closed User Passcode: ${process.env.APP_PASSCODE || '1234'}`);
  console.log(`🔑 OCR.space API Key: ${process.env.OCR_SPACE_API_KEY ? 'Configured' : 'Missing'}`);
  console.log(`====================================================`);
});
