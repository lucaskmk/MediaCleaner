import express from 'express';
import path from 'path';
import fs from 'fs';

const app = express();
const port = process.env.PORT || 5000;
const distDir = path.join(process.cwd(), 'dist');

// Security headers
const isProd = process.env.NODE_ENV === 'production';

// Strict CSP for production, relaxed for local development to allow DevTools/HMR
const CSP = isProd
  ? "default-src 'none'; base-uri 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; worker-src 'none'; manifest-src 'self';"
  : "default-src 'none'; base-uri 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' ws: wss: blob:; object-src 'none'; worker-src 'none'; manifest-src 'self';";

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'interest-cohort=()');
  next();
});

// Serve metadata.json directly from project root if present (manifest)
app.get('/metadata.json', (req, res) => {
  const metaPath = path.join(process.cwd(), 'metadata.json');
  if (fs.existsSync(metaPath)) return res.sendFile(metaPath);
  return res.status(404).end();
});

// Serve installer files with proper headers and range support
app.get('/installer/:name', async (req, res) => {
  try {
    const name = path.basename(req.params.name);
    const installerPath = path.join(distDir, 'installer', name);

    // Prevent path traversal
    if (!installerPath.startsWith(path.join(distDir, 'installer'))) {
      return res.status(400).end('Invalid installer path');
    }

    if (!fs.existsSync(installerPath)) return res.status(404).end('Not found');

    const stat = fs.statSync(installerPath);
    const total = stat.size;
    const range = req.headers.range;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Accept-Ranges', 'bytes');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      if (isNaN(start) || isNaN(end) || start > end) return res.status(416).end();
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', (end - start + 1).toString());
      const stream = fs.createReadStream(installerPath, { start, end });
      stream.pipe(res);
    } else {
      res.setHeader('Content-Length', total.toString());
      const stream = fs.createReadStream(installerPath);
      stream.pipe(res);
    }
  } catch (err) {
    console.error('Installer serve error', err);
    res.status(500).end('Server error');
  }
});

// Return SHA256 checksum for an installer (computed on-the-fly)
app.get('/installer/:name.sha256', async (req, res) => {
  try {
    const base = req.params.name; // includes .sha256 suffix
    const name = base.replace(/\.sha256$/i, '');
    const installerPath = path.join(distDir, 'installer', name);
    if (!fs.existsSync(installerPath)) return res.status(404).end('Not found');

    res.setHeader('Content-Type', 'text/plain');
    const hash = require('crypto').createHash('sha256');
    const stream = fs.createReadStream(installerPath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      const digest = hash.digest('hex');
      res.send(`${digest}  ${name}`);
    });
    stream.on('error', (err) => {
      console.error('Checksum error', err);
      res.status(500).end('Server error');
    });
  } catch (err) {
    console.error(err);
    res.status(500).end('Server error');
  }
});

// Serve static files from dist
app.use(express.static(distDir, { extensions: ['html'] }));

// Fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Secure preview server running at http://localhost:${port}`);
});
