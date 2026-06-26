#pragma once
// VideoGen.h — text/image-to-video via a local REST server.
//
// This module targets two interchangeable backends — whichever you run locally:
//
//   1. ComfyUI (recommended, free):
//        python main.py --listen --port 8188
//      API: POST /prompt  with a workflow JSON
//
//   2. Simple SVD (Stable Video Diffusion) HTTP wrapper:
//        A thin Python wrapper around diffusers SVDPipeline.
//        Example wrapper in scripts/svd_server.py (provided separately).
//      API: POST /generate  { "prompt": "...", "num_frames": 14 }
//           ← { "video_path": "/tmp/output.mp4" }
//
//   3. Wan2.1 / CogVideoX via a local OpenAI-compatible API
//
// The module is backend-agnostic via a BackendType enum.

#include <string>
#include "../http/HttpClient.h"

namespace video_gen {

enum class BackendType {
    SimpleWrapper,   // Generic "POST /generate → { video_path }" server
    ComfyUI,         // ComfyUI workflow API
};

struct VideoParams {
    std::string prompt;
    int         num_frames   = 14;
    int         fps          = 7;
    float       motion_scale = 127.0f;  // SVD-specific: motion bucket id
    int         width        = 512;
    int         height       = 512;
    // Path to an input image for image-to-video (optional; leave empty for txt2vid).
    std::string input_image_path;
};

struct VideoResult {
    bool        success{false};
    std::string saved_path;   // local path where the video was saved
    std::string error;
};

class VideoGen {
public:
    explicit VideoGen(const std::string& base_url   = "http://localhost:8188",
                      const std::string& output_dir = "outputs/videos",
                      BackendType backend           = BackendType::SimpleWrapper);

    VideoResult generate(const VideoParams& params);
    VideoResult generate(const std::string& prompt);

    bool is_server_up() const;
    void set_output_dir(const std::string& dir) { output_dir_ = dir; }
    void set_backend(BackendType b)              { backend_    = b;   }

private:
    http::HttpClient http_;
    std::string      output_dir_;
    BackendType      backend_;

    // Backend-specific dispatch.
    VideoResult generate_simple_wrapper(const VideoParams& p);
    VideoResult generate_comfyui(const VideoParams& p);

    // Copy a file from src to the output_dir; returns destination path.
    std::string copy_to_output(const std::string& src_path,
                               const std::string& prompt) const;
};

} // namespace video_gen
