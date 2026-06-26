#include "HttpClient.h"
#include <curl/curl.h>
#include <stdexcept>

namespace http {

// libcurl write callback — appends received bytes to a std::string.
static size_t write_callback(char* ptr, size_t size, size_t nmemb, void* userdata) {
    auto* buf = static_cast<std::string*>(userdata);
    buf->append(ptr, size * nmemb);
    return size * nmemb;
}

HttpClient::HttpClient() {
    // curl_global_init is not thread-safe; call it once from main() or accept
    // the race on first construction (acceptable for a single-threaded CLI).
    curl_global_init(CURL_GLOBAL_DEFAULT);
    curl_ = curl_easy_init();
    if (!curl_) throw std::runtime_error("curl_easy_init() failed");
}

HttpClient::~HttpClient() {
    if (curl_) {
        curl_easy_cleanup(static_cast<CURL*>(curl_));
        curl_ = nullptr;
    }
    // curl_global_cleanup() intentionally omitted — safe to call at exit.
}

std::string HttpClient::resolve(const std::string& url) const {
    // If the caller already gave a full URL, use it as-is.
    if (url.starts_with("http://") || url.starts_with("https://"))
        return url;
    return base_url_ + url;
}

Response HttpClient::post(const std::string& url,
                          const std::string& json_body,
                          int timeout_seconds) const {
    auto* c = static_cast<CURL*>(curl_);
    Response resp;
    std::string full_url = resolve(url);

    // Build the Content-Type header list.
    curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    headers = curl_slist_append(headers, "Accept: application/json");

    curl_easy_setopt(c, CURLOPT_URL,            full_url.c_str());
    curl_easy_setopt(c, CURLOPT_HTTPHEADER,     headers);
    curl_easy_setopt(c, CURLOPT_POSTFIELDS,     json_body.c_str());
    curl_easy_setopt(c, CURLOPT_POSTFIELDSIZE,  static_cast<long>(json_body.size()));
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION,  write_callback);
    curl_easy_setopt(c, CURLOPT_WRITEDATA,      &resp.body);
    curl_easy_setopt(c, CURLOPT_TIMEOUT,        static_cast<long>(timeout_seconds));
    curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT, 10L);

    CURLcode rc = curl_easy_perform(c);
    curl_slist_free_all(headers);

    if (rc != CURLE_OK) {
        resp.error = curl_easy_strerror(rc);
    } else {
        curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &resp.status_code);
    }

    // Reset for the next call.
    curl_easy_reset(c);
    return resp;
}

Response HttpClient::get(const std::string& url, int timeout_seconds) const {
    auto* c = static_cast<CURL*>(curl_);
    Response resp;
    std::string full_url = resolve(url);

    curl_easy_setopt(c, CURLOPT_URL,           full_url.c_str());
    curl_easy_setopt(c, CURLOPT_HTTPGET,       1L);
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(c, CURLOPT_WRITEDATA,     &resp.body);
    curl_easy_setopt(c, CURLOPT_TIMEOUT,       static_cast<long>(timeout_seconds));
    curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT, 10L);

    CURLcode rc = curl_easy_perform(c);

    if (rc != CURLE_OK) {
        resp.error = curl_easy_strerror(rc);
    } else {
        curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &resp.status_code);
    }

    curl_easy_reset(c);
    return resp;
}

} // namespace http
