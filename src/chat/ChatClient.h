#pragma once
// ChatClient.h — multi-turn conversation against an Ollama-compatible server.
//
// Compatible servers:
//   • Ollama          : http://localhost:11434  (default)
//   • llama.cpp server: http://localhost:8080   (use set_base_url + set_api_path)
//
// Wire protocol (Ollama /api/chat):
//   POST {"model":"...", "messages":[{"role":"...","content":"..."},...], "stream":false}
//   ← {"message":{"role":"assistant","content":"..."},"done":true,...}

#include <string>
#include <vector>
#include "../http/HttpClient.h"

namespace chat {

struct Message {
    std::string role;     // "system" | "user" | "assistant"
    std::string content;
};

class ChatClient {
public:
    explicit ChatClient(const std::string& base_url  = "http://localhost:11434",
                        const std::string& model      = "llama3",
                        const std::string& api_path   = "/api/chat");

    // Send one user turn; returns the assistant reply.
    // The full history is kept in memory automatically.
    std::string chat(const std::string& user_message);

    // Prepend a system prompt (clears existing system messages).
    void set_system_prompt(const std::string& prompt);

    // Inspect or modify history.
    const std::vector<Message>& history() const { return history_; }
    void clear_history();

    // Switch to a different model without losing history.
    void set_model(const std::string& model) { model_ = model; }
    const std::string& model() const         { return model_; }

    // Ping the server; returns true if reachable.
    bool is_server_up() const;

private:
    http::HttpClient http_;
    std::string      model_;
    std::string      api_path_;
    std::vector<Message> history_;

    std::string build_request_body() const;
    std::string parse_reply(const std::string& json_body) const;
};

} // namespace chat
