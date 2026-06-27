# LocalMind Assistant

A local AI assistant with a web UI. Chat with a local LLM, generate images, and generate videos — all running on your own machine. No internet required after first-time model downloads (Google login is optional).

```
Browser → http://localhost:8080
              │
         Angular UI (Auth, Chat, Image, Video)
              │
         Node.js Backend (port 3000)
              │
    ┌─────────┼──────────┬──────────┬──────────┐
    │         │          │          │          │
 Ollama    Image       Video     MongoDB    MinIO
 :11434    Server      Server    :27017     :9000
 (chat)    :7860       :8765    (history)  (storage)
```

---

## Features

### Chat
- Multi-turn conversation with any Ollama model
- Streaming responses (token by token)
- Works without login — history saved to MongoDB when signed in
- Save chat as JSON or TXT

### Image Generation
- Text to image via Stable Diffusion
- Configurable width, height, steps, CFG scale
- **Real-time step progress bar** during generation
- Generate button disabled until current job completes
- Previous images shown when logged in (stored in MinIO / MongoDB)

### Video Generation
- Text to video via ModelScope
- Configurable frames and FPS
- **Real-time step progress bar** during generation
- Generate button disabled until current job completes
- Previous videos shown when logged in

### Authentication (optional)
- Sign in with Google
- Chat history, images, and videos persist across sessions when logged in
- Sidebar shows user avatar + name; logout available on all pages

### Sidebar Job Tracker
- Active generation jobs shown in sidebar with spinner / ✓ / ✗
- Jobs survive route navigation (switch between chat/image/video freely)
- Supports multiple concurrent jobs

### Settings
- Switch LLM model
- View server status (Ollama, Image server, Video server)

---

## Option A — Docker (recommended)

### Prerequisites

| Tool | Download |
|------|----------|
| Docker Desktop | https://www.docker.com/products/docker-desktop |

### Steps

**1. Clone the repo**
```powershell
git clone https://github.com/your-username/LocalMind
cd LocalMind
```

**2. Configure `.env`**

Copy `.env.example` to `.env` and fill in the required values:

```env
# LLM model (required)
OLLAMA_MODEL=mistral

# HuggingFace token — optional, removes download rate limits
HF_TOKEN=hf_your_token_here

# Google OAuth — get from https://console.cloud.google.com
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com

# JWT secret — any random string
JWT_SECRET=change-me-to-a-random-secret

# MongoDB + MinIO — defaults work with Docker Compose
MONGODB_URI=mongodb://mongodb:27017/localmind
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# Docker project name (keeps volume names stable)
COMPOSE_PROJECT_NAME=localmind
```

**3. Start everything**
```powershell
docker compose up --build
```

First run downloads:
- Ollama + mistral model (~4GB)
- Stable Diffusion model (~4GB) — on first image generation
- ModelScope video model (~3.5GB) — on first video generation

**4. Open the UI**

Go to http://localhost:8080 in your browser.

### Ports

| Service | URL |
|---------|-----|
| Web UI | http://localhost:8080 |
| Backend API | http://localhost:3000 |
| Ollama | http://localhost:11434 |
| Image server | http://localhost:7860 |
| Video server | http://localhost:8765 |
| MongoDB | localhost:27017 |
| MinIO console | http://localhost:9001 (admin / minioadmin) |

### Common commands

```powershell
# Start
docker compose up --build

# Stop
docker compose down

# Start again without rebuilding (faster)
docker compose up

# View logs
docker logs localmind-backend-1 -f
docker logs localmind-image-server-1 -f
docker logs localmind-video-server-1 -f

# Pull a different LLM model
docker exec -it localmind-ollama-1 ollama pull llama3

# Rebuild one service only
docker compose up --build image-server
```

### Change the LLM model

Edit `.env`:
```
OLLAMA_MODEL=llama3
```
Then restart:
```powershell
docker compose down
docker compose up
```

Available models:

| Model | RAM needed | Quality |
|-------|-----------|---------|
| mistral | 8GB | Good |
| llama3 | 8GB | Great |
| gemma3:4b | 4GB | Fast |
| phi4 | 10GB | Excellent |
| deepseek-r1 | 8GB | Best for reasoning |

---

## Option B — Run Locally (no Docker)

### Prerequisites

| Tool | Download |
|------|----------|
| Node.js (LTS) | https://nodejs.org |
| Python 3.10+ | https://www.python.org |
| Ollama | https://ollama.com/download |
| MongoDB | https://www.mongodb.com/try/download/community |
| MinIO | https://min.io/download (optional — images served locally if skipped) |

### Steps

**1. Install Python dependencies**
```powershell
pip install flask diffusers accelerate torch torchvision transformers imageio imageio-ffmpeg
```

**2. Configure environment**

Create `backend/.env`:
```env
OLLAMA_URL=http://localhost:11434
SD_URL=http://localhost:7860
VIDEO_URL=http://localhost:8765
MONGODB_URI=mongodb://localhost:27017/localmind
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
JWT_SECRET=change-me
```

Create `frontend/src/assets/config.js`:
```js
window.__API_URL__ = 'http://localhost:3000';
window.__GOOGLE_CLIENT_ID__ = 'your-client-id.apps.googleusercontent.com';
```

**3. Open 5 terminal windows:**

**Terminal 1 — LLM server**
```powershell
ollama serve
ollama pull mistral   # first time only
```

**Terminal 2 — Image server**
```powershell
python scripts/image_server.py
```

**Terminal 3 — Video server**
```powershell
python scripts/svd_server.py
```

**Terminal 4 — Backend API**
```powershell
cd backend
npm install
node server.js
```

**Terminal 5 — Frontend**
```powershell
cd frontend
npm install
npm start
```

**4. Open** http://localhost:4200

---

## Project Structure

```
LocalMind/
├── docker-compose.yml              # All services (backend, frontend, ollama, mongodb, minio)
├── Dockerfile.frontend             # Angular → nginx
├── Dockerfile.backend              # Node.js API
├── nginx.conf                      # Proxy /api/ to backend
├── .env                            # Environment variables (see .env.example)
├── .env.example                    # Template with all required vars documented
│
├── frontend/                       # Angular 17 standalone components
│   └── src/app/
│       ├── app.component.ts        # Shell, sidebar, job tracker
│       ├── app.routes.ts           # /chat (public), /image /video /settings (auth-guarded)
│       ├── guards/
│       │   └── auth.guard.ts       # Redirects to /login if not authenticated
│       ├── interceptors/
│       │   └── auth.interceptor.ts # Attaches Bearer token to all requests
│       ├── services/
│       │   ├── ai.service.ts       # API calls (chat, image, video, status)
│       │   ├── auth.service.ts     # Google login, JWT storage, user BehaviorSubject
│       │   └── generation.service.ts # Multi-job tracker (BehaviorSubject array)
│       └── pages/
│           ├── login/              # Google Sign-In button (GSI library)
│           ├── chat/               # Chat with optional save to MongoDB
│           ├── image/              # SD image gen + progress polling + history
│           ├── video/              # ModelScope video gen + progress polling + history
│           └── settings/           # Model + server config
│
├── backend/                        # Node.js Express API
│   ├── server.js                   # All routes
│   ├── db.js                       # MongoDB connection (mongoose)
│   ├── minio.js                    # MinIO client, bucket setup, presigned URLs
│   ├── middleware/
│   │   └── auth.js                 # signToken, verifyAuth, optionalAuth
│   └── models/
│       ├── user.model.js           # googleId, email, name, picture
│       ├── chat.model.js           # userId, title, messages[]
│       ├── image.model.js          # userId, prompt, filename, minioKey, dimensions
│       └── video.model.js          # userId, prompt, filename, minioKey, frames/fps
│
├── scripts/
│   ├── image_server.py             # Flask + Stable Diffusion (with step callbacks)
│   ├── svd_server.py               # Flask + ModelScope video (with step callbacks)
│   ├── Dockerfile.image-server
│   └── Dockerfile.video-server
│
└── outputs/                        # Locally served generated files
    ├── images/                     # .png files (also uploaded to MinIO)
    └── videos/                     # .mp4 files (also uploaded to MinIO)
```

---

## Authentication Setup (Google OAuth)

1. Go to https://console.cloud.google.com → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add `http://localhost:8080` and `http://localhost:4200` as **Authorized JavaScript origins**
4. Copy the Client ID into `.env` as `GOOGLE_CLIENT_ID`
5. Also set it in `frontend/src/assets/config.js` as `window.__GOOGLE_CLIENT_ID__`

The app works without login — chat is fully public. Login adds persistence (history stored in MongoDB, files in MinIO).

---

## Generation Progress

Both image and video servers expose a `/status` endpoint:

```json
{ "state": "generating", "progress": 45, "message": "Generating image (9/20 steps)..." }
```

States: `idle → downloading → loading → ready → generating → ready`

The frontend polls this endpoint every 800ms during active generation and shows:
- A progress bar above the Generate button
- Step count and percentage inside the button label
- Button stays disabled until the job completes

---

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| RAM | 16GB | 32GB |
| GPU VRAM | 4GB | 8GB+ |
| Disk space | 20GB free | 40GB free |
| OS | Windows 10/11, Linux, macOS | |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Generate button disabled | Model is still loading — watch the progress bar |
| `⚠ Image/Video server not running` | Start the Python server or check Docker logs |
| Chat not working | Run `docker logs localmind-ollama-1` — model may still be pulling |
| Sign-in failed | Check `GOOGLE_CLIENT_ID` in `.env` and `config.js` match exactly |
| MongoDB connection error | Ensure MongoDB is running; check `MONGODB_URI` in `.env` |
| Images not displaying | Backend serves them at `/outputs/images/` — check backend is running |
| Port already in use | Run `docker compose down` then `docker compose up` |
| Out of memory | Switch to a smaller model: `OLLAMA_MODEL=gemma3:4b` in `.env` |
| Slow downloads | Add `HF_TOKEN` to `.env` to remove HuggingFace rate limits |
| Volume data lost after rename | Docker named volumes are prefixed by project name — set `COMPOSE_PROJECT_NAME=localmind` in `.env` |
