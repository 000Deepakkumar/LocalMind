#pragma once
// HttpClient.h — thin RAII wrapper around libcurl for JSON REST calls.
// All AI modules (chat, image, video) use this instead of raw curl handles.

#include <string>
#include <unordered_map>

namespace http {

struct Response {
    long        status_code{0};
    std::string body;
    std::string error;   // non-empty when curl itself failed (not HTTP error)

    bool ok()     const { return error.empty() && status_code >= 200 && status_code < 300; }
    bool failed() const { return !ok(); }
};

// One instance per thread is fine; curl_easy_handle is not thread-safe.
class HttpClient {
public:
    HttpClient();
    ~HttpClient();

    // Disable copy; allow move.
    HttpClient(const HttpClient&)            = delete;
    HttpClient& operator=(const HttpClient&) = delete;
    HttpClient(HttpClient&&)                 = default;
    HttpClient& operator=(HttpClient&&)      = default;

    // POST application/json, returns full response.
    Response post(const std::string& url,
                  const std::string& json_body,
                  int timeout_seconds = 120) const;

    // GET, returns full response.
    Response get(const std::string& url,
                 int timeout_seconds = 30) const;

    // Set a base URL prefix (e.g. "http://localhost:11434") so callers
    // can pass only paths like "/api/chat".
    void set_base_url(const std::string& base) { base_url_ = base; }

private:
    void*       curl_{nullptr};   // CURL* stored as void* to avoid including curl.h here
    std::string base_url_;

    std::string resolve(const std::string& url) const;
};

} // namespace http
