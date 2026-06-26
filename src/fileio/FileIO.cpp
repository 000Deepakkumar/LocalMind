#include "FileIO.h"
#include <nlohmann/json.hpp>
#include <fstream>
#include <sstream>
#include <iomanip>
#include <chrono>
#include <filesystem>
#include <stdexcept>

using json = nlohmann::json;
namespace fs = std::filesystem;

namespace fileio {

// ── Timestamps ────────────────────────────────────────────────────────────────

std::string current_timestamp() {
    auto now = std::chrono::system_clock::now();
    auto t   = std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    std::ostringstream ss;
    ss << std::put_time(&tm, "%Y-%m-%dT%H:%M:%SZ");
    return ss.str();
}

static std::string file_timestamp() {
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

// ── next_filename ─────────────────────────────────────────────────────────────

std::string next_filename(const std::string& output_dir,
                          const std::string& prefix,
                          const std::string& extension) {
    fs::create_directories(output_dir);
    std::string name = file_timestamp() + "_" + prefix + extension;
    return (fs::path(output_dir) / name).string();
}

// ── Save plain text ───────────────────────────────────────────────────────────

bool save_chat_txt(const std::vector<ChatEntry>& history,
                   const std::string& filepath) {
    std::ofstream f(filepath);
    if (!f) return false;

    f << "# Chat saved at " << current_timestamp() << "\n\n";

    for (const auto& e : history) {
        // Skip system prompts in the text log (they clutter human reading).
        if (e.role == "system") continue;

        // Capitalise role for readability: "User" / "Assistant"
        std::string role = e.role;
        if (!role.empty()) role[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(role[0])));

        f << "[" << role << "] ";
        if (!e.timestamp.empty()) f << "(" << e.timestamp << ") ";
        f << "\n" << e.content << "\n\n";
    }

    return true;
}

// ── Save JSON ─────────────────────────────────────────────────────────────────

bool save_chat_json(const std::vector<ChatEntry>& history,
                    const std::string& filepath) {
    json arr = json::array();
    for (const auto& e : history) {
        arr.push_back({
            {"role",      e.role},
            {"content",   e.content},
            {"timestamp", e.timestamp}
        });
    }

    json doc = {
        {"saved_at", current_timestamp()},
        {"messages", arr}
    };

    std::ofstream f(filepath);
    if (!f) return false;

    f << doc.dump(2);   // pretty-print with 2-space indent
    return true;
}

// ── Load JSON ─────────────────────────────────────────────────────────────────

std::vector<ChatEntry> load_chat_json(const std::string& filepath) {
    std::ifstream f(filepath);
    if (!f) throw std::runtime_error("Cannot open: " + filepath);

    json doc;
    f >> doc;

    std::vector<ChatEntry> history;
    for (const auto& item : doc["messages"]) {
        ChatEntry e;
        e.role      = item.value("role",      "");
        e.content   = item.value("content",   "");
        e.timestamp = item.value("timestamp", "");
        history.push_back(std::move(e));
    }
    return history;
}

} // namespace fileio
