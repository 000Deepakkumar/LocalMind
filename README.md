# LocalMind Assistant

A fully offline AI assistant with a web UI. Chat with a local LLM, generate images, and generate videos — all running on your own machine. No internet required after first-time model downloads.

```
Browser → http://localhost:8080
              │
         Angular UI
              │
         Node.js Backend (port 3000)
              │
    ┌─────────┼──────────┐
    │         │          │
 Ollama    Image       Video
 :11434    Server      Server
 (chat)    :7860       :8765
```


---

## Option A — Docker (recommended)

Everything runs in one command. No need to install Node.js, Python, or anything else except Docker.

### Prerequisites

| Tool | Download |
|------|----------|
| Docker Desktop | https://www.docker.com/products/docker-desktop |

### Steps

**1. Clone the repo**
```powershell
git clone https://github.com/your-username/AI-Modal
cd AI-Modal
```

**2. Set your HuggingFace token (optional but speeds up downloads)**

Get a free token at https://huggingface.co → Settings → Access Tokens → New Token (Read permission only)

Edit `.env` in the project root:
```
OLLAMA_MODEL=mistral
HF_TOKEN=hf_your_token_here
```

**3. Start everything**
```powershell
docker compose up --build
```

First run downloads:
- Ollama + mistral model (~4GB)
- Stable Diffusion model (~4GB) — downloads on first image generation
- ModelScope video model (~3.5GB) — downloads on first video generation

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

### Common commands

```powershell
# Start
docker compose up --build

# Stop
docker compose down

# Start again without rebuilding (faster)
docker compose up

# View logs
docker logs ai-backend -f
docker logs image-server -f
docker logs video-server -f

# Pull a different LLM model
docker exec -it ollama ollama pull llama3

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

Available models (pick based on your RAM):

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

### Steps

**1. Install Python dependencies**
```powershell
pip install flask diffusers accelerate torch torchvision transformers imageio imageio-ffmpeg
```

**2. Open 5 terminal windows and run one command in each:**

**Terminal 1 — LLM server**
```powershell
ollama serve
```
First time only — pull a model:
```powershell
ollama pull mistral
```

**Terminal 2 — Image server**
```powershell
cd "C:\path\to\AI-Modal"
python scripts/image_server.py
```
Downloads SD model (~4GB) on first run.

**Terminal 3 — Video server**
```powershell
cd "C:\path\to\AI-Modal"
python scripts/svd_server.py
```
Downloads ModelScope model (~3.5GB) on first run.

**Terminal 4 — Backend API**
```powershell
cd "C:\path\to\AI-Modal\backend"
npm install
node server.js
```

**Terminal 5 — Frontend**
```powershell
cd "C:\path\to\AI-Modal\frontend"
npm install
npm start
```

**3. Open the UI**

Go to http://localhost:4200 in your browser.

---

## Features

### Chat
- Multi-turn conversation with any Ollama model
- Streaming responses (token by token)
- Session history persists through page refresh
- Save chat as JSON or TXT
- Switch models via Settings page

### Image Generation
- Text to image via Stable Diffusion
- Configurable width, height, steps, CFG scale
- Shows download progress on first run
- Generated images persist through page refresh
- Click image to open full size

### Video Generation
- Text to video via ModelScope (1.7B — works on 4GB GPU)
- Configurable frames and FPS
- Videos persist through page refresh

### Settings
- Switch LLM model
- View server status
- Quick reference commands

---

## Project Structure

```
AI-Modal/
├── docker-compose.yml          # All services in one file
├── Dockerfile.frontend         # Angular → nginx
├── Dockerfile.backend          # Node.js API
├── nginx.conf                  # Proxy /api/ to backend
├── .env                        # OLLAMA_MODEL, HF_TOKEN
│
├── frontend/                   # Angular 17 web UI
│   └── src/app/
│       ├── app.component.ts    # Shell + sidebar + server status
│       ├── services/
│       │   └── ai.service.ts   # API calls to backend
│       └── pages/
│           ├── chat/           # Chat interface
│           ├── image/          # Image generation
│           ├── video/          # Video generation
│           └── settings/       # Model + server config
│
├── backend/                    # Node.js Express API
│   ├── server.js               # Routes: /api/chat, /image, /video
│   └── .env                    # Local server URLs
│
├── scripts/
│   ├── image_server.py         # Flask + Stable Diffusion
│   ├── svd_server.py           # Flask + ModelScope video
│   ├── Dockerfile.image-server
│   └── Dockerfile.video-server
│
├── src/                        # Original C++ CLI (optional)
│   ├── main.cpp
│   ├── chat/
│   ├── image/
│   ├── video/
│   ├── fileio/
│   └── http/
│
└── outputs/                    # Saved files
    ├── chats/                  # .json and .txt chat logs
    ├── images/                 # .png generated images
    └── videos/                 # .mp4 generated videos
```

---

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| RAM | 16GB | 32GB |
| GPU VRAM | 4GB | 8GB+ |
| Disk space | 20GB free | 40GB free |
| OS | Windows 10/11, Linux, macOS | |

> Your setup: 28GB RAM + 4GB GPU — chat and image generation work well. Video generation works but is slow on CPU if VRAM is insufficient.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Generate button disabled | Image server is still downloading the model — wait for it |
| Chat not working | Run `docker logs ollama` — model may still be pulling |
| Image generation fails | Check `docker logs image-server` for errors |
| Video generation fails | Check `docker logs video-server` — model may still be downloading |
| Port already in use | Run `docker compose down` then `docker compose up` again |
| Out of memory | Switch to a smaller model: `OLLAMA_MODEL=gemma3:4b` in `.env` |
| Slow downloads | Add `HF_TOKEN` to `.env` to remove HuggingFace rate limits |
