// main.cpp — Local AI Assistant
// A terminal-based chat interface that talks to local AI servers.
//
// Commands (type at the prompt):
//   /help           — show this list
//   /image <prompt> — generate an image with Stable Diffusion
//   /video <prompt> — generate a video with SVD / ComfyUI
//   /save           — save current chat to outputs/chats/
//   /savejson       — save as JSON
//   /load <file>    — reload a previously saved JSON chat
//   /model <name>   — switch LLM model (e.g. /model mistral)
//   /system <txt>   — set a system prompt
//   /clear          — clear chat history (keeps system prompt)
//   /status         — check all server connections
//   /quit           — exit

#include <iostream>
#include <string>
#include <sstream>
#include <vector>
#include <algorithm>
#include <filesystem>

#include "chat/ChatClient.h"
#include "image/ImageGen.h"
#include "video/VideoGen.h"
#include "fileio/FileIO.h"

namespace fs = std::filesystem;

// ── ANSI colour helpers (degrade gracefully on Windows if not enabled) ────────
namespace color {
    constexpr const char* reset   = "\033[0m";
    constexpr const char* bold    = "\033[1m";
    constexpr const char* cyan    = "\033[36m";
    constexpr const char* green   = "\033[32m";
    constexpr const char* yellow  = "\033[33m";
    constexpr const char* red     = "\033[31m";
    constexpr const char* magenta = "\033[35m";
    constexpr const char* blue    = "\033[34m";
}

// Enable ANSI escape codes on Windows 10+.
static void enable_ansi_on_windows() {
#ifdef _WIN32
    HANDLE h = GetStdHandle(STD_OUTPUT_HANDLE);
    if (h != INVALID_HANDLE_VALUE) {
        DWORD mode = 0;
        if (GetConsoleMode(h, &mode))
            SetConsoleMode(h, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
    }
#endif
}

// ── Banner ────────────────────────────────────────────────────────────────────
static void print_banner() {
    std::cout << color::cyan << color::bold
              << R"(
 _                    _        _    _____     _            _     _              _
| |    ___   ___ __ _| |      / \  |_ _\ \   / |  /\  /\  | |_ | |_  _ __ ___| |_
| |   / _ \ / __/ _` | |     / _ \  | | \ \ / /  / /_/ /  | __|| __|| '__/ _ \ __|
| |__| (_) | (_| (_| | |_   / ___ \ | |  \ V /  / __  /   | |_ | |_ | | |  __/ |_
|_____\___/ \___\__,_|_( ) /_/   \_\___|  \_/   \/ /_/     \__| \__||_|  \___|\__|
                        |/
)"
              << color::reset << "\n"
              << color::yellow << "  Fully offline · Chat · Image · Video · File I/O\n"
              << color::reset
              << "  Type " << color::green << "/help" << color::reset
              << " to see available commands.\n\n";
}

// ── Help text ─────────────────────────────────────────────────────────────────
static void print_help() {
    std::cout << color::bold << "\n  Commands\n" << color::reset
              << "  ─────────────────────────────────────────────────\n"
              << "  " << color::green << "/help"          << color::reset << "              show this message\n"
              << "  " << color::green << "/image <prompt>"<< color::reset << "   generate image (SD WebUI)\n"
              << "  " << color::green << "/video <prompt>"<< color::reset << "   generate video (ComfyUI / SVD)\n"
              << "  " << color::green << "/save"          << color::reset << "              save chat as .txt\n"
              << "  " << color::green << "/savejson"      << color::reset << "          save chat as .json\n"
              << "  " << color::green << "/load <file>"   << color::reset << "      reload a .json chat file\n"
              << "  " << color::green << "/model <name>"  << color::reset << "     switch LLM model\n"
              << "  " << color::green << "/system <text>" << color::reset << "    set system prompt\n"
              << "  " << color::green << "/clear"         << color::reset << "             clear chat history\n"
              << "  " << color::green << "/status"        << color::reset << "            check server connections\n"
              << "  " << color::green << "/quit"          << color::reset << "              exit\n"
              << "  ─────────────────────────────────────────────────\n"
              << "  (any other input is sent to the LLM as a chat message)\n\n";
}

// ── Server status check ───────────────────────────────────────────────────────
static void print_status(const chat::ChatClient& chat,
                         const image_gen::ImageGen& img,
                         const video_gen::VideoGen& vid) {
    auto check = [](bool up, const char* name, const char* url) {
        std::cout << "  " << (up ? color::green : color::red)
                  << (up ? "✓ " : "✗ ") << name
                  << color::reset << " (" << url << ")\n";
    };

    std::cout << "\n  Server status:\n";
    check(chat.is_server_up(), "Ollama / LLM   ", "localhost:11434");
    check(img.is_server_up(),  "SD WebUI       ", "localhost:7860 ");
    check(vid.is_server_up(),  "Video (ComfyUI)", "localhost:8188 ");
    std::cout << "\n";
}

// ── Extract argument after a command token ────────────────────────────────────
static std::string arg_after(const std::string& line, const std::string& cmd) {
    if (line.size() <= cmd.size()) return "";
    return line.substr(cmd.size() + 1);   // skip the space after the command
}

// ── Convert ChatClient history → FileIO entries with timestamps ───────────────
static std::vector<fileio::ChatEntry>
to_fileio_history(const std::vector<chat::Message>& messages) {
    std::vector<fileio::ChatEntry> out;
    for (const auto& m : messages)
        out.push_back({m.role, m.content, fileio::current_timestamp()});
    return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
int main() {
#ifdef _WIN32
    enable_ansi_on_windows();
#endif

    print_banner();

    // ── Instantiate all modules ──────────────────────────────────────────────
    chat::ChatClient    llm("http://localhost:11434", "llama3");
    image_gen::ImageGen img("http://localhost:7860",  "outputs/images");
    video_gen::VideoGen vid("http://localhost:8188",  "outputs/videos",
                            video_gen::BackendType::SimpleWrapper);

    // Default system prompt: sets personality.
    llm.set_system_prompt(
        "You are a helpful, concise local AI assistant. "
        "You run entirely offline. Answer clearly and directly."
    );

    std::cout << color::yellow
              << "  Using model: " << llm.model() << "\n"
              << "  (Tip: run /status to verify your local servers are up)\n\n"
              << color::reset;

    // ── REPL loop ────────────────────────────────────────────────────────────
    std::string line;
    while (true) {
        std::cout << color::bold << color::blue << "You> " << color::reset;
        if (!std::getline(std::cin, line)) break;   // EOF (Ctrl-D / Ctrl-Z)

        // Trim leading/trailing whitespace.
        auto trim = [](std::string& s) {
            s.erase(s.begin(), std::find_if(s.begin(), s.end(),
                [](unsigned char c){ return !std::isspace(c); }));
            s.erase(std::find_if(s.rbegin(), s.rend(),
                [](unsigned char c){ return !std::isspace(c); }).base(), s.end());
        };
        trim(line);
        if (line.empty()) continue;

        // ── Commands ─────────────────────────────────────────────────────────
        if (line == "/quit" || line == "/exit" || line == "/q") {
            std::cout << color::cyan << "Goodbye!\n" << color::reset;
            break;
        }

        if (line == "/help") {
            print_help();
            continue;
        }

        if (line == "/status") {
            print_status(llm, img, vid);
            continue;
        }

        if (line == "/clear") {
            llm.clear_history();
            std::cout << color::yellow << "  Chat history cleared.\n\n" << color::reset;
            continue;
        }

        if (line == "/save") {
            auto path = fileio::next_filename("outputs/chats", "chat", ".txt");
            bool ok   = fileio::save_chat_txt(to_fileio_history(llm.history()), path);
            if (ok)
                std::cout << color::green << "  Saved: " << path << "\n\n" << color::reset;
            else
                std::cout << color::red << "  Error saving to: " << path << "\n\n" << color::reset;
            continue;
        }

        if (line == "/savejson") {
            auto path = fileio::next_filename("outputs/chats", "chat", ".json");
            bool ok   = fileio::save_chat_json(to_fileio_history(llm.history()), path);
            if (ok)
                std::cout << color::green << "  Saved: " << path << "\n\n" << color::reset;
            else
                std::cout << color::red << "  Error saving to: " << path << "\n\n" << color::reset;
            continue;
        }

        if (line.starts_with("/load ")) {
            std::string file = arg_after(line, "/load");
            try {
                auto history = fileio::load_chat_json(file);
                // Rebuild the chat client history from the file.
                llm.clear_history();
                for (const auto& e : history) {
                    if (e.role == "system") llm.set_system_prompt(e.content);
                    // For user/assistant messages we can't directly push — so
                    // we print the loaded history and let the user continue.
                }
                std::cout << color::green << "  Loaded " << history.size()
                          << " messages from: " << file << "\n\n" << color::reset;
                for (const auto& e : history) {
                    if (e.role == "system") continue;
                    std::string r = e.role;
                    if (!r.empty()) r[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(r[0])));
                    std::cout << "  " << color::bold << r << ": " << color::reset << e.content << "\n";
                }
                std::cout << "\n";
            } catch (const std::exception& ex) {
                std::cout << color::red << "  Load failed: " << ex.what() << "\n\n" << color::reset;
            }
            continue;
        }

        if (line.starts_with("/model ")) {
            std::string new_model = arg_after(line, "/model");
            llm.set_model(new_model);
            std::cout << color::yellow << "  Switched to model: " << new_model << "\n\n" << color::reset;
            continue;
        }

        if (line.starts_with("/system ")) {
            llm.set_system_prompt(arg_after(line, "/system"));
            std::cout << color::yellow << "  System prompt updated.\n\n" << color::reset;
            continue;
        }

        // ── /image <prompt> ──────────────────────────────────────────────────
        if (line.starts_with("/image ")) {
            std::string prompt = arg_after(line, "/image");
            if (prompt.empty()) {
                std::cout << color::red << "  Usage: /image <prompt>\n\n" << color::reset;
                continue;
            }

            std::cout << color::magenta << "  Generating image…\n" << color::reset;
            auto result = img.generate(prompt);

            if (result.success)
                std::cout << color::green << "  Image saved: " << result.saved_path
                          << "\n\n" << color::reset;
            else
                std::cout << color::red << "  Image generation failed: " << result.error
                          << "\n\n" << color::reset;
            continue;
        }

        // ── /video <prompt> ──────────────────────────────────────────────────
        if (line.starts_with("/video ")) {
            std::string prompt = arg_after(line, "/video");
            if (prompt.empty()) {
                std::cout << color::red << "  Usage: /video <prompt>\n\n" << color::reset;
                continue;
            }

            std::cout << color::magenta
                      << "  Generating video (this can take several minutes)…\n"
                      << color::reset;
            auto result = vid.generate(prompt);

            if (result.success)
                std::cout << color::green << "  Video saved: " << result.saved_path
                          << "\n\n" << color::reset;
            else
                std::cout << color::red << "  Video generation failed: " << result.error
                          << "\n\n" << color::reset;
            continue;
        }

        // ── Unknown command ───────────────────────────────────────────────────
        if (line.starts_with("/")) {
            std::cout << color::red << "  Unknown command. Type /help for a list.\n\n"
                      << color::reset;
            continue;
        }

        // ── Normal chat message → LLM ─────────────────────────────────────────
        std::cout << color::magenta << "  Thinking…" << color::reset << std::flush;

        try {
            std::string reply = llm.chat(line);
            // Erase the "Thinking…" line.
            std::cout << "\r" << std::string(14, ' ') << "\r";

            std::cout << color::bold << color::cyan << "AI> "
                      << color::reset << reply << "\n\n";

        } catch (const std::exception& ex) {
            std::cout << "\r" << std::string(14, ' ') << "\r";
            std::cout << color::red << "  Error: " << ex.what() << "\n"
                      << "  (Is the Ollama server running? Try: ollama serve)\n\n"
                      << color::reset;
        }
    }

    return 0;
}
