// server.js — Express API gateway
// Proxies requests from the Angular UI to LocalMind servers:
//   Ollama      → http://ollama:11434   (chat)
//   SD WebUI    → http://localhost:7860 (images)
//   Video server→ http://localhost:8188 (video)

const express   = require('express');
const axios     = require('axios');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const { v4: uuidv4 }    = require('uuid');
const rateLimit = require('express-rate-limit');

// Load .env file so local runs work without Docker
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// All AI services talk to localhost when running directly.
// Override via backend/.env or docker-compose environment section.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const SD_URL     = process.env.SD_URL     || 'http://localhost:7860';
const VIDEO_URL  = process.env.VIDEO_URL  || 'http://localhost:8765';
const MODEL      = process.env.OLLAMA_MODEL || 'mistral';

// Output directories — use relative path for local, absolute for Docker
const BASE_DIR   = process.env.OUTPUTS_BASE || path.join(__dirname, '..', 'outputs');
const IMAGES_DIR = process.env.IMAGES_DIR   || path.join(BASE_DIR, 'images');
const VIDEOS_DIR = process.env.VIDEOS_DIR   || path.join(BASE_DIR, 'videos');
const CHATS_DIR  = process.env.CHATS_DIR    || path.join(BASE_DIR, 'chats');

[IMAGES_DIR, VIDEOS_DIR, CHATS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── CORS — only allow known origins ──────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Always allow same-origin (no Origin header) and localhost
    if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return cb(null, true);
    }
    // Allow explicitly listed origins from .env
    if (ALLOWED_ORIGINS.some(allowed => origin === allowed || origin.endsWith(allowed))) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────

// General API: 120 requests / minute per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down.' },
});

// Chat: 20 messages / minute per IP (LLM is expensive)
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Chat rate limit reached — wait a moment.' },
});

// Image: 5 generations / minute per IP (SD takes time anyway)
const imageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Image rate limit reached — wait a moment.' },
});

// Video: 2 generations / minute per IP (video takes several minutes)
const videoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2,
  message: { error: 'Video rate limit reached — wait a moment.' },
});

app.use('/api/', generalLimiter);
app.use('/api/chat', chatLimiter);
app.use('/api/image', imageLimiter);
app.use('/api/video', videoLimiter);

app.use(express.json({ limit: '50mb' }));

// Serve saved images and videos statically
app.use('/outputs/images', express.static(IMAGES_DIR));
app.use('/outputs/videos', express.static(VIDEOS_DIR));

// ── GET /api/image/status ─────────────────────────────────────────────────────
app.get('/api/image/status', async (req, res) => {
  try {
    const r = await axios.get(`${SD_URL}/status`, { timeout: 3000 });
    res.json(r.data);
  } catch {
    res.json({ state: 'unknown' });
  }
});

// ── GET /api/video/status ─────────────────────────────────────────────────────
app.get('/api/video/status', async (req, res) => {
  try {
    const r = await axios.get(`${VIDEO_URL}/status`, { timeout: 3000 });
    res.json(r.data);
  } catch {
    res.json({ state: 'unknown' });
  }
});

// ── GET /api/status ───────────────────────────────────────────────────────────
// Returns up/down state of each AI server.
app.get('/api/status', async (req, res) => {
  const check = async (url) => {
    try {
      await axios.get(url, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  };

  const [ollamaUp, sdUp, videoUp] = await Promise.all([
    check(OLLAMA_URL),
    check(SD_URL + '/sdapi/v1/sd-models'),
    check(VIDEO_URL),
  ]);

  res.json({
    ollama: ollamaUp,
    stableDiffusion: sdUp,
    video: videoUp,
    model: MODEL,
  });
});

// ── GET /api/models ───────────────────────────────────────────────────────────
// List models available in Ollama.
app.get('/api/models', async (req, res) => {
  try {
    const r = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
    res.json(r.data);
  } catch (e) {
    res.status(503).json({ error: 'Ollama unreachable', detail: e.message });
  }
});

// ── POST /api/chat ────────────────────────────────────────────────────────────
// Body: { model, messages: [{role, content}] }
// Streams the Ollama response back to the client via SSE.
app.post('/api/chat', async (req, res) => {
  const { messages, model } = req.body;

  // Set up Server-Sent Events so the UI can stream tokens.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const ollamaResp = await axios.post(
      `${OLLAMA_URL}/api/chat`,
      { model: model || MODEL, messages, stream: true },
      { responseType: 'stream', timeout: 180000 }
    );

    let fullContent = '';

    ollamaResp.data.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          const token = json?.message?.content || '';
          if (token) {
            fullContent += token;
            // Send each token as an SSE event.
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
          if (json.done) {
            res.write(`data: ${JSON.stringify({ done: true, full: fullContent })}\n\n`);
            res.end();
          }
        } catch { /* partial chunk — ignore */ }
      }
    });

    ollamaResp.data.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// ── POST /api/image ───────────────────────────────────────────────────────────
// Body: { prompt, negative_prompt, width, height, steps, cfg_scale, seed }
// Returns: { success, url, filename, error }
app.post('/api/image', async (req, res) => {
  const {
    prompt,
    negative_prompt = 'ugly, blurry, low quality',
    width  = 512,
    height = 512,
    steps  = 20,
    cfg_scale = 7,
    seed   = -1,
  } = req.body;

  try {
    const sdResp = await axios.post(
      `${SD_URL}/sdapi/v1/txt2img`,
      { prompt, negative_prompt, width, height, steps, cfg_scale, seed,
        sampler_name: 'Euler a', batch_size: 1, save_images: false },
      { timeout: 300000 }
    );

    const b64 = sdResp.data.images?.[0];
    if (!b64) return res.status(500).json({ error: 'No image returned from SD' });

    // Strip data-URI prefix if present.
    const raw = b64.replace(/^data:image\/png;base64,/, '');
    const filename = `${Date.now()}_${prompt.slice(0,30).replace(/\W+/g,'_')}.png`;
    const filepath = path.join(IMAGES_DIR, filename);

    fs.writeFileSync(filepath, Buffer.from(raw, 'base64'));

    res.json({ success: true, url: `/outputs/images/${filename}`, filename });

  } catch (e) {
    const detail = e.response?.data || e.message;
    res.status(503).json({ error: 'Image generation failed', detail });
  }
});

// ── POST /api/video ───────────────────────────────────────────────────────────
// Body: { prompt, num_frames, fps, width, height }
// Returns: { success, url, filename, error }
app.post('/api/video', async (req, res) => {
  const {
    prompt,
    num_frames = 14,
    fps        = 7,
    width      = 512,
    height     = 512,
  } = req.body;

  try {
    const vidResp = await axios.post(
      `${VIDEO_URL}/generate`,
      { prompt, num_frames, fps, width, height },
      { timeout: 600000 }
    );

    const srcPath = vidResp.data?.video_path;
    if (!srcPath) return res.status(500).json({ error: 'No video path returned' });

    const filename = `${Date.now()}_${prompt.slice(0,30).replace(/\W+/g,'_')}.mp4`;
    const destPath = path.join(VIDEOS_DIR, filename);

    fs.copyFileSync(srcPath, destPath);

    res.json({ success: true, url: `/outputs/videos/${filename}`, filename });

  } catch (e) {
    const detail = e.response?.data || e.message;
    res.status(503).json({ error: 'Video generation failed', detail });
  }
});

// ── POST /api/chat/save ───────────────────────────────────────────────────────
// Body: { messages: [{role, content}] }
// Saves chat history to disk and returns the filename.
app.post('/api/chat/save', (req, res) => {
  const { messages } = req.body;
  const filename = `${Date.now()}_chat.json`;
  const filepath = path.join(CHATS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify({ saved_at: new Date().toISOString(), messages }, null, 2));
  res.json({ success: true, filename });
});

app.listen(PORT, () => {
  console.log(`[backend] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[backend] Ollama  → ${OLLAMA_URL}  (model: ${MODEL})`);
  console.log(`[backend] SD WebUI→ ${SD_URL}`);
  console.log(`[backend] Video   → ${VIDEO_URL}`);
});
