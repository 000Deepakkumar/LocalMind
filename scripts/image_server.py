#!/usr/bin/env python3
"""
image_server.py — Minimal Stable Diffusion image generation server.

Install dependencies:
    pip install flask diffusers accelerate torch torchvision transformers

Run:
    python scripts/image_server.py

This starts a server on http://localhost:7860 that the backend will call.
Compatible with the AUTOMATIC1111 SD WebUI API format so no backend changes needed.
"""

import argparse
import base64
import io
import os
import torch
from flask import Flask, request, jsonify
from pathlib import Path

app = Flask(__name__)
pipeline = None

# Track download/load progress globally so the /status endpoint can report it.
server_state = {
    "state":    "idle",       # idle | downloading | loading | ready | error
    "progress": 0,            # 0-100
    "message":  "Not started",
}

def load_pipeline(model_id: str):
    global pipeline, server_state
    if pipeline is not None:
        return pipeline

    from diffusers import StableDiffusionPipeline, DPMSolverMultistepScheduler
    from huggingface_hub import snapshot_download
    import threading

    server_state["state"]   = "downloading"
    server_state["message"] = "Downloading model files (~4GB)..."
    server_state["progress"] = 0

    print(f"[image_server] Loading model: {model_id}")
    print("[image_server] This may take a few minutes on first run (downloads ~4GB)...")

    # Use tqdm progress callback to track download progress.
    from tqdm import tqdm as tqdm_original

    downloaded_bytes = [0]
    total_bytes      = [1]

    original_init = tqdm_original.__init__

    def patched_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        if self.total:
            total_bytes[0] = max(total_bytes[0], self.total)

    original_update = tqdm_original.update

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

    server_state["state"] = "downloading"

    pipeline = StableDiffusionPipeline.from_pretrained(
        model_id,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        safety_checker=None,
        requires_safety_checker=False
    )

    # Restore tqdm
    tqdm_original.__init__  = original_init
    tqdm_original.update    = original_update

    server_state["state"]    = "loading"
    server_state["progress"] = 99
    server_state["message"]  = "Loading model into memory..."

    pipeline.scheduler = DPMSolverMultistepScheduler.from_config(
        pipeline.scheduler.config
    )

    if torch.cuda.is_available():
        pipeline = pipeline.to("cuda")
        print("[image_server] Using GPU")
    else:
        pipeline.enable_attention_slicing()
        print("[image_server] Using CPU (generation will be slow ~5-10 min per image)")

    server_state["state"]    = "ready"
    server_state["progress"] = 100
    server_state["message"]  = "Model ready!"
    print("[image_server] Model ready!")
    return pipeline


# ── AUTOMATIC1111-compatible endpoint ────────────────────────────────────────
@app.route("/sdapi/v1/txt2img", methods=["POST"])
def txt2img():
    data = request.get_json(force=True)

    prompt          = data.get("prompt", "")
    negative_prompt = data.get("negative_prompt", "ugly, blurry, low quality")
    width           = int(data.get("width",  512))
    height          = int(data.get("height", 512))
    steps           = int(data.get("steps",  20))
    cfg_scale       = float(data.get("cfg_scale", 7.0))
    seed            = int(data.get("seed", -1))

    if not prompt:
        return jsonify({"error": "prompt is required"}), 400

    try:
        pipe = load_pipeline(MODEL_ID)

        # Set seed for reproducibility
        generator = None
        if seed != -1:
            generator = torch.Generator().manual_seed(seed)

        server_state["state"]    = "generating"
        server_state["progress"] = 0
        server_state["message"]  = f"Generating image (0/{steps} steps)..."

        def step_callback(pipe, step, timestep, kwargs):
            pct = int((step + 1) / steps * 100)
            server_state["progress"] = pct
            server_state["message"]  = f"Generating image ({step + 1}/{steps} steps)..."
            return kwargs

        result = pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_inference_steps=steps,
            guidance_scale=cfg_scale,
            generator=generator,
            num_images_per_prompt=1,
            callback_on_step_end=step_callback,
        )

        server_state["state"]    = "ready"
        server_state["progress"] = 100
        server_state["message"]  = "Model ready!"

        image = result.images[0]

        # Convert PIL image to base64 PNG
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        # Return in AUTOMATIC1111 format
        return jsonify({"images": [b64], "parameters": data, "info": "{}"})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ── Health check (so backend /api/status can detect us) ──────────────────────
@app.route("/sdapi/v1/sd-models", methods=["GET"])
def sd_models():
    return jsonify([{"title": MODEL_ID, "model_name": MODEL_ID}])


@app.route("/status", methods=["GET"])
def status():
    return jsonify(server_state)

@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "image_server", "model": MODEL_ID})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port",  type=int, default=int(os.environ.get("PORT", 7860)))
    parser.add_argument("--host",  type=str, default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--model", type=str, default=os.environ.get(
        "SD_MODEL", "runwayml/stable-diffusion-v1-5"
    ))
    args = parser.parse_args()

    MODEL_ID = args.model

    print(f"[image_server] Starting on http://{args.host}:{args.port}")
    print(f"[image_server] Model: {MODEL_ID}")
    print(f"[image_server] CUDA available: {torch.cuda.is_available()}")

    # Pre-load the model in a background thread so it's ready before first request.
    import threading
    threading.Thread(target=load_pipeline, args=(MODEL_ID,), daemon=True).start()

    app.run(host=args.host, port=args.port, debug=False)
