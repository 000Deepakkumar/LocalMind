#pragma once
// FileIO.h — save / load chat history and manage output file paths.
//
// Two formats are supported:
//   • Plain text (.txt)  — human-readable, one message per line
//   • JSON      (.json)  — machine-parseable, preserves role metadata

#include <string>
#include <vector>

namespace fileio {

struct ChatEntry {
    std::string role;     // "system" | "user" | "assistant"
    std::string content;
    std::string timestamp;  // ISO 8601
};

// ── Save ──────────────────────────────────────────────────────────────────────

// Save chat history as a plain text log.
// Each line: "[ROLE] content"
bool save_chat_txt(const std::vector<ChatEntry>& history,
                   const std::string& filepath);

// Save chat history as structured JSON.
bool save_chat_json(const std::vector<ChatEntry>& history,
                    const std::string& filepath);

// ── Load ─────────────────────────────────────────────────────────────────────

// Load a previously saved JSON chat file.
std::vector<ChatEntry> load_chat_json(const std::string& filepath);

// ── Utility ───────────────────────────────────────────────────────────────────

// Return a timestamped filename inside output_dir, e.g.
//   next_filename("outputs/chats", "chat", ".json")
//   → "outputs/chats/20240615_143022_chat.json"
std::string next_filename(const std::string& output_dir,
                          const std::string& prefix,
                          const std::string& extension);

// Get current UTC time as ISO 8601 string.
std::string current_timestamp();

} // namespace fileio
