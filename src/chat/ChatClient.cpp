#include "ChatClient.h"
#include <nlohmann/json.hpp>
#include <stdexcept>

using json = nlohmann::json;

namespace chat {

ChatClient::ChatClient(const std::string& base_url,
                       const std::string& model,
                       const std::string& api_path)
    : model_(model), api_path_(api_path)
{
    http_.set_base_url(base_url);
}

void ChatClient::set_system_prompt(const std::string& prompt) {
    // Remove any existing system message and insert the new one at the front.
    std::erase_if(history_, [](const Message& m){ return m.role == "system"; });
    history_.insert(history_.begin(), Message{"system", prompt});
}

void ChatClient::clear_history() {
    // Preserve the system prompt if present.
    std::vector<Message> kept;
    for (auto& m : history_)
        if (m.role == "system") kept.push_back(m);
    history_ = std::move(kept);
}

std::string ChatClient::build_request_body() const {
    json messages = json::array();
    for (const auto& m : history_)
        messages.push_back({{"role", m.role}, {"content", m.content}});

    json body = {
        {"model",    model_},
        {"messages", messages},
        {"stream",   false}     // request a single complete response
    };
    return body.dump();
}

std::string ChatClient::parse_reply(const std::string& json_body) const {
    try {
        auto j = json::parse(json_body);

        // Ollama format: { "message": { "role": "assistant", "content": "..." } }
        if (j.contains("message") && j["message"].contains("content"))
            return j["message"]["content"].get<std::string>();

        // llama.cpp /v1/chat/completions format (OpenAI-compatible):
        // { "choices": [{ "message": { "content": "..." } }] }
        if (j.contains("choices") && !j["choices"].empty())
            return j["choices"][0]["message"]["content"].get<std::string>();

        // Fallback: return the raw body so the user sees *something*.
        return json_body;

    } catch (const json::exception& e) {
        throw std::runtime_error(std::string("JSON parse error: ") + e.what()
                                 + "\nRaw body: " + json_body);
    }
}

std::string ChatClient::chat(const std::string& user_message) {
    history_.push_back(Message{"user", user_message});

    auto resp = http_.post(api_path_, build_request_body(), /*timeout=*/180);

    if (resp.failed())
        throw std::runtime_error("HTTP error " + std::to_string(resp.status_code)
                                 + ": " + (resp.error.empty() ? resp.body : resp.error));

    std::string reply = parse_reply(resp.body);
    history_.push_back(Message{"assistant", reply});
    return reply;
}

bool ChatClient::is_server_up() const {
    // Ollama exposes GET / → 200 when healthy.
    auto resp = http_.get("/", 5);
    return resp.ok() || resp.status_code == 200;
}

} // namespace chat
