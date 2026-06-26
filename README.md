# Local AI Assistant (C++)

A fully offline, terminal-based AI assistant that talks to local model servers.
No cloud API keys. No internet required after setup.

```
┌─────────────────────────────────────────┐
│            local_ai (C++20)             │
│                                         │
│  ┌──────────┐  ┌──────────┐  ┌───────┐ │
│  │   Chat   │  │  Image   │  │ Video │ │
│  │ ChatClient  │  ImageGen│  │VideoGen│
│  └────┬─────┘  └────┬─────┘  └───┬───┘ │
│       │             │             │     │
│  ┌────▼─────────────▼─────────────▼───┐ │
│  │           HttpClient (libcurl)      │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
         │              │             │
   Ollama:11434   SD:7860      ComfyUI:8188
   (llama3 etc)  (AUTOMATIC1111)  (SVD/AnimateDiff)
```

## Prerequisites

| Component | What to install |
|-----------|----------------|
| C++ toolchain | MSVC 2022 / GCC 13 / Clang 16 |
| CMake | ≥ 3.16 |
| libcurl | Dev package (`libcurl-dev` on Linux, vcpkg on Windows) |
| nlohmann/json | See `third_party/nlohmann/README.md` |
| **LLM server** | [Ollama](https://ollama.ai) — `ollama serve && ollama pull llama3` |
| **Image server** | [AUTOMATIC1111 SD WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) — `python launch.py --api` |
| **Video server** | [ComfyUI](https://github.com/comfyanonymous/ComfyUI) OR `python scripts/svd_server.py` |

## Build

```bash
# 1. Grab nlohmann/json (one-time)
curl -L -o third_party/nlohmann/json.hpp \
  https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp

# 2. Configure
cmake -B build -DCMAKE_BUILD_TYPE=Release

# 3. Build
cmake --build build --parallel

# 4. Run
./build/bin/local_ai
```

### Windows (vcpkg)
```powershell
vcpkg install curl:x64-windows
cmake -B build -DCMAKE_TOOLCHAIN_FILE="$env:VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake" `
      -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
.\build\bin\Release\local_ai.exe
```

## Usage

```
You> Hello, what can you do?
AI>  I can chat with you, generate images (/image), generate videos (/video),
     save our conversation (/save), and more. Type /help for the full list.

You> /image a futuristic city at night, neon lights, cyberpunk style
  Generating image…
  Image saved: outputs/images/20240615_143022_a_futuristic_city_at.png

You> /video a red balloon floating over a meadow
  Generating video (this can take several minutes)…
  Video saved: outputs/videos/20240615_143155_a_red_balloon_floating.mp4

You> /save
  Saved: outputs/chats/20240615_143200_chat.txt

You> /quit
Goodbye!
```

## Project structure

```
local-ai-assistant/
├── CMakeLists.txt
├── README.md
├── scripts/
│   └── svd_server.py         # Optional Python SVD wrapper
├── src/
│   ├── main.cpp              # CLI REPL, command dispatch
│   ├── chat/
│   │   ├── ChatClient.h/.cpp # Multi-turn LLM conversation
│   ├── image/
│   │   ├── ImageGen.h/.cpp   # Stable Diffusion image generation
│   ├── video/
│   │   ├── VideoGen.h/.cpp   # SVD / ComfyUI video generation
│   ├── fileio/
│   │   ├── FileIO.h/.cpp     # Save/load chat history
│   └── http/
│       ├── HttpClient.h/.cpp # libcurl RAII wrapper
├── third_party/
│   └── nlohmann/
│       └── json.hpp          # (download separately — see above)
└── outputs/
    ├── chats/                # .txt and .json chat logs
    ├── images/               # .png generated images
    └── videos/               # .mp4 generated videos
```

## Switching backends

### llama.cpp server instead of Ollama
```cpp
// In main.cpp, change:
chat::ChatClient llm("http://localhost:8080", "llama-3-8b",
                     "/v1/chat/completions");   // OpenAI-compatible path
```

### ComfyUI for video
```cpp
video_gen::VideoGen vid("http://localhost:8188", "outputs/videos",
                        video_gen::BackendType::ComfyUI);
```

### Standalone SVD server
```bash
python scripts/svd_server.py --port 8765
```
```cpp
video_gen::VideoGen vid("http://localhost:8765", "outputs/videos",
                        video_gen::BackendType::SimpleWrapper);
```
