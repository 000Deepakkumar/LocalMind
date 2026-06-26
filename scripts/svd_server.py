#!/usr/bin/env python3
"""
svd_server.py — Minimal HTTP wrapper around diffusers SVDPipeline (Stable Video Diffusion).

Usage:
    pip install flask diffusers accelerate torch torchvision
    python svd_server.py --port 8765

The C++ app can then call:
    VideoGen vid("http://localhost:8765", "outputs/videos", BackendType::SimpleWrapper);
"""

import argparse
import os
import tempfile
from pathlib import Path

from flask import Flask, request, jsonify

app = Flask(__name__)
pipeline = None   # loaded on first request to avoid slow startup


def load_pipeline():
    global pipeline
    if pipeline is not None:
        return pipeline

    # Import heavy deps only when the server actually needs them.
    import torch
    from diffusers import StableVideoDiffusionPipeline
    from diffusers.utils import load_image

    print("[svd_server] Loading SVD pipeline (this may take a minute)…")
    pipeline = StableVideoDiffusionPipeline.from_pretrained(
        "stabilityai/stable-video-diffusion-img2vid-xt",
        torch_dtype=torch.float16,
        variant="fp16",
    )
    pipeline.enable_model_cpu_offload()
    print("[svd_server] Pipeline ready.")
    return pipeline


@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json(force=True)

    prompt      = data.get("prompt", "A beautiful scene")
    num_frames  = int(data.get("num_frames", 14))
    fps         = int(data.get("fps", 7))
    motion_id   = int(data.get("motion_bucket", 127))
    width       = int(data.get("width", 512))
    height      = int(data.get("height", 512))
    input_image = data.get("input_image", None)   # path to a conditioning image

    try:
        import torch
        from diffusers.utils import load_image, export_to_video
        from PIL import Image

        pipe = load_pipeline()

        if input_image and os.path.exists(input_image):
            cond = load_image(input_image).resize((width, height))
        else:
            # No conditioning image: create a blank white frame.
            cond = Image.new("RGB", (width, height), color=(255, 255, 255))

        frames = pipe(
            cond,
            num_frames=num_frames,
            decode_chunk_size=8,
            motion_bucket_id=motion_id,
        ).frames[0]

        # Write to a temp file; the C++ app copies it to outputs/videos/.
        tmp_path = tempfile.mktemp(suffix=".mp4")
        export_to_video(frames, tmp_path, fps=fps)

        return jsonify({"video_path": tmp_path})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "svd_server"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    print(f"[svd_server] Listening on http://{args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=False)
