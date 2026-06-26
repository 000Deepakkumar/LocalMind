#include "VideoGen.h"
#include <nlohmann/json.hpp>
#include <fstream>
#include <sstream>
#include <iomanip>
#include <chrono>
#include <filesystem>
#include <thread>
#include <stdexcept>

using json = nlohmann::json;
namespace fs = std::filesystem;

namespace video_gen {

// ── Helpers ───────────────────────────────────────────────────────────────────

static std::string timestamp_str() {
    auto now = std::chrono::system_clock::now();
    auto t   = std::chrono::system_clock::to_time_t(now);
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

static std::string prompt_slug(const std::string& p, size_t max = 30) {
    std::string s;
    for (char c : p) {
        if (std::isalnum(static_cast<unsigned char>(c))) s += c;
        else if (c == ' ')                               s += '_';
        if (s.size() >= max) break;
    }
    return s.empty() ? "video" : s;
}

// ── VideoGen implementation ───────────────────────────────────────────────────

VideoGen::VideoGen(const std::string& base_url,
                   const std::string& output_dir,
                   BackendType backend)
    : output_dir_(output_dir), backend_(backend)
{
    http_.set_base_url(base_url);
    fs::create_directories(output_dir_);
}

std::string VideoGen::copy_to_output(const std::string& src_path,
                                     const std::string& prompt) const {
    std::string ext = fs::path(src_path).extension().string();
    if (ext.empty()) ext = ".mp4";

    std::string dest_name = timestamp_str() + "_" + prompt_slug(prompt) + ext;
    fs::path    dest      = fs::path(output_dir_) / dest_name;

    fs::copy_file(src_path, dest, fs::copy_options::overwrite_existing);
    return dest.string();
}

// ── SimpleWrapper backend ─────────────────────────────────────────────────────
// Expects a minimal Python server (see scripts/svd_server.py).
// POST /generate  → { "video_path": "/abs/path/to/output.mp4" }
//               or → { "error": "..." }
VideoResult VideoGen::generate_simple_wrapper(const VideoParams& p) {
    VideoResult result;

    json body = {
        {"prompt",        p.prompt},
        {"num_frames",    p.num_frames},
        {"fps",           p.fps},
        {"width",         p.width},
        {"height",        p.height},
        {"motion_bucket", static_cast<int>(p.motion_scale)}
    };
    if (!p.input_image_path.empty())
        body["input_image"] = p.input_image_path;

    // Video generation can take several minutes.
    auto resp = http_.post("/generate", body.dump(), /*timeout=*/600);

    if (resp.failed()) {
        result.error = "HTTP error " + std::to_string(resp.status_code)
                       + ": " + (resp.error.empty() ? resp.body : resp.error);
        return result;
    }

    try {
        auto j = json::parse(resp.body);

        if (j.contains("error")) {
            result.error = j["error"].get<std::string>();
            return result;
        }

        std::string video_path = j.value("video_path", "");
        if (video_path.empty()) {
            result.error = "Server returned no video path.";
            return result;
        }

        // Copy the video from the server's temp dir to our output dir.
        result.saved_path = copy_to_output(video_path, p.prompt);
        result.success    = true;

    } catch (const std::exception& e) {
        result.error = e.what();
    }

    return result;
}

// ── ComfyUI backend ───────────────────────────────────────────────────────────
// ComfyUI uses a queue-based workflow API. We submit a minimal txt2vid workflow,
// poll /history until the job is done, then fetch the output file path.
VideoResult VideoGen::generate_comfyui(const VideoParams& p) {
    VideoResult result;

    // Minimal ComfyUI workflow for SVD / AnimateDiff text-to-video.
    // In production, load this from a JSON file so it's user-configurable.
    json workflow = {
        {"prompt", {
            {"1", {{"class_type","CheckpointLoaderSimple"},
                   {"inputs",{{"ckpt_name","v2-1_768-ema-pruned.safetensors"}}}}},
            {"2", {{"class_type","CLIPTextEncode"},
                   {"inputs",{{"text", p.prompt},{"clip",{"1",1}}}}}},
            {"3", {{"class_type","CLIPTextEncode"},
                   {"inputs",{{"text","ugly, blurry"},{"clip",{"1",1}}}}}},
            {"4", {{"class_type","KSampler"},
                   {"inputs",{
                       {"seed",42},{"steps",20},{"cfg",7},
                       {"sampler_name","euler"},{"scheduler","normal"},
                       {"denoise",1},
                       {"model",{"1",0}},
                       {"positive",{"2",0}},{"negative",{"3",0}},
                       {"latent_image",{"5",0}}
                   }}}},
            {"5", {{"class_type","EmptyLatentImage"},
                   {"inputs",{{"width",p.width},{"height",p.height},
                               {"batch_size",p.num_frames}}}}},
            {"6", {{"class_type","VAEDecode"},
                   {"inputs",{{"samples",{"4",0}},{"vae",{"1",2}}}}}},
            {"7", {{"class_type","VHS_VideoCombine"},
                   {"inputs",{
                       {"images",{"6",0}},
                       {"frame_rate",p.fps},
                       {"loop_count",0},
                       {"filename_prefix","ai_video"},
                       {"format","video/h264-mp4"},
                       {"pingpong",false},
                       {"save_output",true}
                   }}}}
        }}
    };

    // Submit the workflow.
    auto submit_resp = http_.post("/prompt", workflow.dump(), 30);
    if (submit_resp.failed()) {
        result.error = "ComfyUI submit failed: " + submit_resp.error;
        return result;
    }

    std::string prompt_id;
    try {
        auto j    = json::parse(submit_resp.body);
        prompt_id = j.value("prompt_id", "");
    } catch (...) {
        result.error = "Failed to parse ComfyUI submit response.";
        return result;
    }

    if (prompt_id.empty()) {
        result.error = "ComfyUI returned empty prompt_id.";
        return result;
    }

    // Poll /history/{prompt_id} until the job completes (max 10 minutes).
    const int max_polls  = 120;
    const int poll_delay = 5;   // seconds

    for (int i = 0; i < max_polls; ++i) {
        std::this_thread::sleep_for(std::chrono::seconds(poll_delay));

        auto hist_resp = http_.get("/history/" + prompt_id, 10);
        if (hist_resp.failed()) continue;

        try {
            auto j = json::parse(hist_resp.body);
            if (!j.contains(prompt_id)) continue;

            auto& entry   = j[prompt_id];
            auto& outputs = entry["outputs"];

            // Look for any node that saved a video file.
            for (auto& [node_id, node_out] : outputs.items()) {
                if (node_out.contains("videos") && !node_out["videos"].empty()) {
                    std::string filename = node_out["videos"][0]["filename"];
                    std::string subfolder= node_out["videos"][0].value("subfolder","");

                    // Download the file via /view.
                    std::string query = "/view?filename=" + filename;
                    if (!subfolder.empty()) query += "&subfolder=" + subfolder;

                    auto dl = http_.get(query, 120);
                    if (dl.failed()) {
                        result.error = "Failed to download video from ComfyUI.";
                        return result;
                    }

                    // Write raw bytes to output dir.
                    std::string dest_name = timestamp_str() + "_"
                                          + prompt_slug(p.prompt) + ".mp4";
                    fs::path dest = fs::path(output_dir_) / dest_name;
                    std::ofstream f(dest, std::ios::binary);
                    f.write(dl.body.data(), static_cast<std::streamsize>(dl.body.size()));

                    result.saved_path = dest.string();
                    result.success    = true;
                    return result;
                }
            }
        } catch (...) {
            continue;
        }
    }

    result.error = "ComfyUI job timed out after "
                   + std::to_string(max_polls * poll_delay) + " seconds.";
    return result;
}

// ── Public interface ──────────────────────────────────────────────────────────

VideoResult VideoGen::generate(const VideoParams& params) {
    switch (backend_) {
        case BackendType::ComfyUI:       return generate_comfyui(params);
        case BackendType::SimpleWrapper: return generate_simple_wrapper(params);
    }
    return {false, "", "Unknown backend type."};
}

VideoResult VideoGen::generate(const std::string& prompt) {
    VideoParams p;
    p.prompt = prompt;
    return generate(p);
}

bool VideoGen::is_server_up() const {
    auto resp = http_.get("/", 5);
    return resp.ok() || resp.status_code == 200 || resp.status_code == 404;
}

} // namespace video_gen
