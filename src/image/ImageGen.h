#pragma once
// ImageGen.h — text-to-image via the AUTOMATIC1111 Stable Diffusion WebUI REST API.
//
// Prerequisites: launch AUTOMATIC1111 with --api flag:
//   python launch.py --api --listen --port 7860
//
// The API endpoint used:
//   POST http://localhost:7860/sdapi/v1/txt2img
//   ← { "images": ["<base64-PNG>", ...] }

#include <string>
#include "../http/HttpClient.h"

namespace image_gen {

struct GenerationParams {
    std::string prompt;
    std::string negative_prompt = "ugly, blurry, low quality";
    int         width           = 512;
    int         height          = 512;
    int         steps           = 20;
    float       cfg_scale       = 7.0f;   // classifier-free guidance
    int         seed            = -1;     // -1 = random
    std::string sampler         = "Euler a";
};

struct GenerationResult {
    bool        success{false};
    std::string saved_path;   // absolute path on disk
    std::string error;
};

class ImageGen {
public:
    explicit ImageGen(const std::string& base_url    = "http://localhost:7860",
                      const std::string& output_dir  = "outputs/images");

    // Generate an image and save it as a PNG; returns metadata.
    GenerationResult generate(const GenerationParams& params);

    // Quick overload: just pass a prompt, use default params.
    GenerationResult generate(const std::string& prompt);

    bool is_server_up() const;

    void set_output_dir(const std::string& dir) { output_dir_ = dir; }

private:
    http::HttpClient http_;
    std::string      output_dir_;

    std::string build_request_body(const GenerationParams& p) const;

    // Decode base64 PNG data and write it to disk; returns file path.
    std::string save_image(const std::string& b64_data,
                           const std::string& prompt) const;
};

} // namespace image_gen
