#!/usr/bin/env python3
"""
video_server.py — Lightweight text-to-video using ModelScope (damo-vilab).

Model: damo-vilab/text-to-video-ms-1.7b
  - Only 1.7B parameters
  - ~3.5GB download
  - Runs on CPU with 8GB RAM (slow ~5-10 min) or GPU with 4GB VRAM (fast ~1 min)
  - Generates 2-4 second MP4 clips at 256x256

Install:
    pip install flask torch torchvision diffusers transformers accelerate imageio imageio-ffmpeg

Run:
    python scripts/svd_server.py --port 8765
"""

import argparse
import os
import tempfile
import threading

import torch
from flask import Flask, request, jsonify

app  = Flask(__name__)
pipe = None

# Track download/load progress so the UI can show a progress bar.
server_state = {
    "state":    "idle",
    "progress": 0,
    "message":  "Not started",
}


def load_pipeline():
    global pipe, server_state
    if pipe is not None:
        return pipe

    from diffusers import DiffusionPipeline

    model_id = os.environ.get("VIDEO_MODEL", "damo-vilab/text-to-video-ms-1.7b")

    server_state["state"]    = "downloading"
    server_state["progress"] = 0
    server_state["message"]  = "Downloading video model (~3.5GB)..."

    print(f"[video_server] Loading model: {model_id}")
    print("[video_server] First run downloads ~3.5GB — please wait...")

    # Patch tqdm to track download progress.
    from tqdm import tqdm as tqdm_original

    downloaded_bytes = [0]
    total_bytes      = [1]

    original_init   = tqdm_original.__init__
    original_update = tqdm_original.update

    def patched_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        if self.total:
            total_bytes[0] = max(total_bytes[0], self.total)

    def patched_update(self, n=1):
        original_update(self, n)
        downloaded_bytes[0] += n
        pct = min(int(downloaded_bytes[0] / total_bytes[0] * 100), 99)
        server_state["progress"] = pct
        server_state["message"]  = (
            f"Downloading model: {downloaded_bytes[0] // 1024 // 1024} MB "
            f"/ {total_bytes[0] // 1024 // 1024} MB ({pct}%)"
        )

    tqdm_original.__init__  = patched_init
    tqdm_original.update    = patched_update

    pipe = DiffusionPipeline.from_pretrained(
        model_id,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        variant="fp16" if torch.cuda.is_available() else None,
    )

    tqdm_original.__init__  = original_init
    tqdm_original.update    = original_update

    server_state["state"]    = "loading"
    server_state["progress"] = 99
    server_state["message"]  = "Loading model into memory..."

    if torch.cuda.is_available():
        pipe = pipe.to("cuda")
        print("[video_server] Using GPU")
    else:
        try:
            pipe.enable_model_cpu_offload()
        except RuntimeError:
            # accelerate not installed — fall back to plain CPU
            pipe = pipe.to("cpu")
        pipe.enable_vae_slicing()
        print("[video_server] Using CPU (generation will take 5-10 minutes)")

    server_state["state"]    = "ready"
    server_state["progress"] = 100
    server_state["message"]  = "Model ready!"
    print("[video_server] Model ready!")
    return pipe


@app.route("/generate", methods=["POST"])
def generate():
    data       = request.get_json(force=True)
    prompt     = data.get("prompt", "a cat walking in a garden")
    num_frames = int(data.get("num_frames", 16))
    fps        = int(data.get("fps", 8))

    if server_state["state"] != "ready":
        return jsonify({"error": "Model not ready yet. State: " + server_state["state"]}), 503

    try:
        import imageio
        import numpy as np
        p = load_pipeline()

        print(f"[video_server] Generating: {prompt}")

        num_steps = 25
        server_state["state"]    = "generating"
        server_state["progress"] = 0
        server_state["message"]  = f"Generating video (0/{num_steps} steps)..."

        def step_callback(pipe, step, timestep, kwargs):
            pct = int((step + 1) / num_steps * 100)
            server_state["progress"] = pct
            server_state["message"]  = f"Generating video ({step + 1}/{num_steps} steps)..."
            return kwargs

        result = p(
            prompt,
            num_inference_steps=num_steps,
            num_frames=num_frames,
            callback_on_step_end=step_callback,
        )

        server_state["state"]    = "ready"
        server_state["progress"] = 100
        server_state["message"]  = "Model ready!"

        frames = result.frames[0]

        tmp = tempfile.mktemp(suffix=".mp4")
        writer = imageio.get_writer(tmp, fps=fps, codec="libx264", quality=7)
        for frame in frames:
            writer.append_data(np.array(frame))
        writer.close()

        print(f"[video_server] Saved to {tmp}")
        return jsonify({"video_path": tmp})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/status", methods=["GET"])
def status():
    return jsonify(server_state)


@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "video_server"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8765)))
    parser.add_argument("--host", type=str, default=os.environ.get("HOST", "127.0.0.1"))
    args = parser.parse_args()

    print(f"[video_server] Starting on http://{args.host}:{args.port}")
    print(f"[video_server] CUDA available: {torch.cuda.is_available()}")

    # Pre-load model in background so it's ready before first request.
    threading.Thread(target=load_pipeline, daemon=True).start()

    app.run(host=args.host, port=args.port, debug=False)
