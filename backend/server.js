// server.js — Express API gateway for LocalMind
// Services: Ollama (chat), Stable Diffusion (images), Video server
// Auth: Google OAuth → JWT
// Storage: MongoDB (users, chats) + MinIO (images, videos, chat exports)

const express   = require('express');
const axios     = require('axios');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const { v4: uuidv4 }    = require('uuid');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');

require('dotenv').config();

const { connectDB }            = require('./db');
const User                     = require('./models/user.model');
const Chat                     = require('./models/chat.model');
const Image                    = require('./models/image.model');
const Video                    = require('./models/video.model');
const { ensureBuckets, BUCKETS, uploadBuffer, getPresignedUrl } = require('./minio');
const { signToken, verifyAuth, optionalAuth } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const SD_URL     = process.env.SD_URL     || 'http://localhost:7860';
const VIDEO_URL  = process.env.VIDEO_URL  || 'http://localhost:8765';
const MODEL      = process.env.OLLAMA_MODEL || 'mistral';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Local output directories (fallback when MinIO is unavailable)
const BASE_DIR   = process.env.OUTPUTS_BASE || path.join(__dirname, '..', 'outputs');
const IMAGES_DIR = process.env.IMAGES_DIR   || path.join(BASE_DIR, 'images');
const VIDEOS_DIR = process.env.VIDEOS_DIR   || path.join(BASE_DIR, 'videos');
const CHATS_DIR  = process.env.CHATS_DIR    || path.join(BASE_DIR, 'chats');

[IMAGES_DIR, VIDEOS_DIR, CHATS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return cb(null, true);
    }
    if (ALLOWED_ORIGINS.some(a => origin === a || origin.endsWith(a))) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({ windowMs: 60*1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' } });
const chatLimiter    = rateLimit({ windowMs: 60*1000, max: 20,  message: { error: 'Chat rate limit reached.' } });
const imageLimiter   = rateLimit({ windowMs: 60*1000, max: 5,   skip: (req) => req.path === '/status', message: { error: 'Image rate limit reached.' } });
const videoLimiter   = rateLimit({ windowMs: 60*1000, max: 2,   skip: (req) => req.path === '/status', message: { error: 'Video rate limit reached.' } });
const authLimiter    = rateLimit({ windowMs: 60*1000, max: 10,  message: { error: 'Auth rate limit reached.' } });

app.use('/api/', generalLimiter);
app.use('/api/chat', chatLimiter);
app.use('/api/image', imageLimiter);
app.use('/api/video', videoLimiter);
app.use('/api/auth', authLimiter);

app.use(express.json({ limit: '50mb' }));

// Serve saved outputs statically (fallback if MinIO not configured)
app.use('/outputs/images', express.static(IMAGES_DIR));
app.use('/outputs/videos', express.static(VIDEOS_DIR));

// ── POST /api/auth/google ─────────────────────────────────────────────────────
// Body: { credential } — Google ID token from the frontend GSI button
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Missing credential' });
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google Client ID not configured on server' });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const { sub: googleId, email, name, picture } = ticket.getPayload();

    let user = await User.findOne({ googleId });
    if (!user) {
      user = await User.create({ googleId, email, name, picture });
      console.log(`[auth] New user: ${email}`);
    }

    const token = signToken({ userId: user._id.toString(), email: user.email });
    res.json({ token, user: { id: user._id, email, name, picture } });
  } catch (e) {
    console.error('[auth] Google verification failed:', e.message);
    res.status(401).json({ error: 'Google token verification failed', detail: e.message });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
app.get('/api/auth/me', verifyAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-__v');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user._id, email: user.email, name: user.name, picture: user.picture });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/image/status ─────────────────────────────────────────────────────
app.get('/api/image/status', async (req, res) => {
  try {
    const r = await axios.get(`${SD_URL}/status`, { timeout: 3000 });
    res.json(r.data);
  } catch { res.json({ state: 'unknown' }); }
});

// ── GET /api/video/status ─────────────────────────────────────────────────────
app.get('/api/video/status', async (req, res) => {
  try {
    const r = await axios.get(`${VIDEO_URL}/status`, { timeout: 3000 });
    res.json(r.data);
  } catch { res.json({ state: 'unknown' }); }
});

// ── GET /api/status ───────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  const check = async (url) => {
    try {
      await axios.get(url, { timeout: 3000, validateStatus: () => true });
      return true;
    } catch { return false; }
  };
  const [ollamaUp, sdUp, videoUp] = await Promise.all([
    check(`${OLLAMA_URL}/api/tags`),
    check(`${SD_URL}/status`),
    check(`${VIDEO_URL}/status`),
  ]);
  res.json({ ollama: ollamaUp, stableDiffusion: sdUp, video: videoUp, model: MODEL });
});

// ── GET /api/models ───────────────────────────────────────────────────────────
app.get('/api/models', async (req, res) => {
  try {
    const r = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
    res.json(r.data);
  } catch (e) {
    res.status(503).json({ error: 'Ollama unreachable', detail: e.message });
  }
});

// ── POST /api/chat ────────────────────────────────────────────────────────────
// Streams Ollama response via SSE. Auth optional.
app.post('/api/chat', optionalAuth, async (req, res) => {
  const { messages, model } = req.body;

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
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
          if (json.done) {
            res.write(`data: ${JSON.stringify({ done: true, full: fullContent })}\n\n`);
            res.end();
          }
        } catch {}
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
// Generates image, saves to disk + uploads to MinIO.
app.post('/api/image', optionalAuth, async (req, res) => {
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

    const raw      = b64.replace(/^data:image\/png;base64,/, '');
    const buffer   = Buffer.from(raw, 'base64');
    const filename = `${Date.now()}_${prompt.slice(0, 30).replace(/\W+/g, '_')}.png`;
    const filepath = path.join(IMAGES_DIR, filename);

    fs.writeFileSync(filepath, buffer);

    // Upload to MinIO (best effort, background — don't block response)
    uploadBuffer(BUCKETS.images, filename, buffer, 'image/png')
      .catch(e => console.warn('[minio] Image upload failed:', e.message));

    // Save metadata to MongoDB (best effort)
    Image.create({
      userId:   req.user?.userId || null,
      prompt, filename, width, height, steps,
      minioKey: filename,
    }).catch(e => console.warn('[db] Image save failed:', e.message));

    const url = `/outputs/images/${filename}`;
    res.json({ success: true, url, filename });
  } catch (e) {
    res.status(503).json({ error: 'Image generation failed', detail: e.response?.data || e.message });
  }
});

// ── POST /api/video ───────────────────────────────────────────────────────────
app.post('/api/video', optionalAuth, async (req, res) => {
  const { prompt, num_frames = 14, fps = 7, width = 512, height = 512 } = req.body;

  try {
    const vidResp = await axios.post(
      `${VIDEO_URL}/generate`,
      { prompt, num_frames, fps, width, height },
      { timeout: 600000 }
    );

    const srcPath = vidResp.data?.video_path;
    if (!srcPath) return res.status(500).json({ error: 'No video path returned' });

    const filename = `${Date.now()}_${prompt.slice(0, 30).replace(/\W+/g, '_')}.mp4`;
    const destPath = path.join(VIDEOS_DIR, filename);
    fs.copyFileSync(srcPath, destPath);

    // Upload to MinIO (best effort, background)
    fs.promises.readFile(destPath)
      .then(buf => uploadBuffer(BUCKETS.videos, filename, buf, 'video/mp4'))
      .catch(e => console.warn('[minio] Video upload failed:', e.message));

    // Save metadata to MongoDB (best effort)
    Video.create({
      userId:     req.user?.userId || null,
      prompt, filename, num_frames, fps,
      minioKey:   filename,
    }).catch(e => console.warn('[db] Video save failed:', e.message));

    const url = `/outputs/videos/${filename}`;
    res.json({ success: true, url, filename });
  } catch (e) {
    res.status(503).json({ error: 'Video generation failed', detail: e.response?.data || e.message });
  }
});

// ── POST /api/chat/save ───────────────────────────────────────────────────────
// Saves chat: to MongoDB when authenticated, also exports JSON to MinIO.
app.post('/api/chat/save', optionalAuth, async (req, res) => {
  const { messages, title } = req.body;
  const filename = `${Date.now()}_chat.json`;
  const payload  = { saved_at: new Date().toISOString(), messages };

  // Save to disk
  fs.writeFileSync(path.join(CHATS_DIR, filename), JSON.stringify(payload, null, 2));

  // Save to MongoDB if authenticated
  let chatId = null;
  if (req.user) {
    try {
      const firstUserMsg = messages.find(m => m.role === 'user');
      const chat = await Chat.create({
        userId:   req.user.userId,
        title:    title || (firstUserMsg?.content?.slice(0, 60) ?? 'Chat'),
        messages,
      });
      chatId = chat._id;
    } catch (e) {
      console.warn('[db] Chat save failed:', e.message);
    }
  }

  // Upload JSON export to MinIO (best effort)
  let minioUrl = null;
  try {
    const buf = Buffer.from(JSON.stringify(payload, null, 2));
    await uploadBuffer(BUCKETS.chats, filename, buf, 'application/json');
    minioUrl = await getPresignedUrl(BUCKETS.chats, filename, 86400);
  } catch (e) {
    console.warn('[minio] Chat upload failed:', e.message);
  }

  res.json({ success: true, filename, chatId, minioUrl });
});

// ── GET /api/images ───────────────────────────────────────────────────────────
app.get('/api/images', verifyAuth, async (req, res) => {
  try {
    const images = await Image.find({ userId: req.user.userId })
      .select('prompt filename width height steps createdAt')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ images: images.map(img => ({
      ...img.toObject(),
      url: `/outputs/images/${img.filename}`,
    }))});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/videos ───────────────────────────────────────────────────────────
app.get('/api/videos', verifyAuth, async (req, res) => {
  try {
    const videos = await Video.find({ userId: req.user.userId })
      .select('prompt filename num_frames fps createdAt')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ videos: videos.map(v => ({
      ...v.toObject(),
      url: `/outputs/videos/${v.filename}`,
    }))});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/chats ────────────────────────────────────────────────────────────
// Returns the authenticated user's saved chats.
app.get('/api/chats', verifyAuth, async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.user.userId })
      .select('title createdAt messages')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ chats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/chats/:id ────────────────────────────────────────────────────────
app.get('/api/chats/:id', verifyAuth, async (req, res) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId: req.user.userId });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/chats/:id ─────────────────────────────────────────────────────
app.delete('/api/chats/:id', verifyAuth, async (req, res) => {
  try {
    await Chat.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
async function start() {
  try { await connectDB(); } catch (e) { console.warn('[db] MongoDB unavailable:', e.message); }
  try { await ensureBuckets(); } catch (e) { console.warn('[minio] MinIO unavailable:', e.message); }

  app.listen(PORT, () => {
    console.log(`[backend] Listening on http://0.0.0.0:${PORT}`);
    console.log(`[backend] Ollama  → ${OLLAMA_URL}  (model: ${MODEL})`);
    console.log(`[backend] SD WebUI→ ${SD_URL}`);
    console.log(`[backend] Video   → ${VIDEO_URL}`);
  });
}

start();
