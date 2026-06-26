#include "ImageGen.h"
#include <nlohmann/json.hpp>
#include <fstream>
#include <sstream>
#include <iomanip>
#include <chrono>
#include <filesystem>
#include <stdexcept>
#include <array>

using json = nlohmann::json;
namespace fs = std::filesystem;

namespace image_gen {

// ── Base64 decode ─────────────────────────────────────────────────────────────
// The SD API returns raw base64 (no data-URI prefix needed).
static std::string base64_decode(const std::string& in) {
    static const std::string chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    std::string out;
    out.reserve(in.size() * 3 / 4);

    int val = 0, bits = -8;
    for (unsigned char c : in) {
        if (c == '=') break;
        auto pos = chars.find(static_cast<char>(c));
        if (pos == std::string::npos) continue;   // skip whitespace / newlines
        val = (val << 6) | static_cast<int>(pos);
        bits += 6;
        if (bits >= 0) {
            out.push_back(static_cast<char>((val >> bits) & 0xFF));
            bits -= 8;
        }
    }
    return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Sanitize a prompt for use as a filename (keep first 40 safe chars).
static std::string prompt_slug(const std::string& prompt) {
    std::string slug;
    for (char c : prompt) {
        if (std::isalnum(static_cast<unsigned char>(c)) || c == ' ')
            slug += c;
        if (slug.size() >= 40) break;
    }
    // Replace spaces with underscores.
    for (char& c : slug)
        if (c == ' ') c = '_';
    return slug.empty() ? "image" : slug;
}

// Generate a timestamp string for unique filenames.
static std::string timestamp_str() {
    auto now  = std::chrono::system_clock::now();
    auto t    = std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
#ifdef _WIN32
    localtime_s(&tm, &t);
#else
    localtime_r(&t, &tm);
#endif
    std::ostringstream ss;
    ss << std::put_time(&tm, "%Y%m%d_%H%M%S");
    return ss.str();
}

// ── ImageGen implementation ───────────────────────────────────────────────────

ImageGen::ImageGen(const std::string& base_url, const std::string& output_dir)
    : output_dir_(output_dir)
{
    http_.set_base_url(base_url);
    fs::create_directories(output_dir_);
}

std::string ImageGen::build_request_body(const GenerationParams& p) const {
    json body = {
        {"prompt",          p.prompt},
        {"negative_prompt", p.negative_prompt},
        {"width",           p.width},
        {"height",          p.height},
        {"steps",           p.steps},
        {"cfg_scale",       p.cfg_scale},
        {"seed",            p.seed},
        {"sampler_name",    p.sampler},
        {"batch_size",      1},
        // Ask the server to return the PNG as base64 (default for SD WebUI).
        {"save_images",     false}
    };
    return body.dump();
}

std::string ImageGen::save_image(const std::string& b64_data,
                                 const std::string& prompt) const {
    std::string raw = base64_decode(b64_data);

    std::string filename = timestamp_str() + "_" + prompt_slug(prompt) + ".png";
    fs::path    path     = fs::path(output_dir_) / filename;

    std::ofstream file(path, std::ios::binary);
    if (!file)
        throw std::runtime_error("Cannot write image to: " + path.string());

    file.write(raw.data(), static_cast<std::streamsize>(raw.size()));
    return path.string();
}

GenerationResult ImageGen::generate(const GenerationParams& params) {
    GenerationResult result;

    auto resp = http_.post("/sdapi/v1/txt2img",
                           build_request_body(params),
                           /*timeout=*/300);   // image gen can be slow

    if (resp.failed()) {
        result.error = "HTTP error " + std::to_string(resp.status_code)
                       + ": " + (resp.error.empty() ? resp.body : resp.error);
        return result;
    }

    try {
        auto j = json::parse(resp.body);

        if (!j.contains("images") || j["images"].empty()) {
            result.error = "Server returned no images. Response: " + resp.body;
            return result;
        }

        // The first element is the base64-encoded PNG.
        std::string b64 = j["images"][0].get<std::string>();

        // SD WebUI sometimes prepends "data:image/png;base64," — strip it.
        const std::string prefix = "data:image/png;base64,";
        if (b64.starts_with(prefix))
            b64 = b64.substr(prefix.size());

        result.saved_path = save_image(b64, params.prompt);
        result.success    = true;

    } catch (const std::exception& e) {
        result.error = e.what();
    }

    return result;
}

GenerationResult ImageGen::generate(const std::string& prompt) {
    GenerationParams p;
    p.prompt = prompt;
    return generate(p);
}

bool ImageGen::is_server_up() const {
    auto resp = http_.get("/sdapi/v1/sd-models", 5);
    return resp.ok();
}

} // namespace image_gen
