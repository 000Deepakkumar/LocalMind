cmake_minimum_required(VERSION 3.16)
project(LocalAIAssistant VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ── Output directories ────────────────────────────────────────────────────────
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

# ── Dependencies ──────────────────────────────────────────────────────────────
find_package(CURL REQUIRED)         # libcurl for HTTP calls
# nlohmann/json is header-only; we ship it in third_party/

# ── Sources ───────────────────────────────────────────────────────────────────
set(SOURCES
    src/main.cpp
    src/http/HttpClient.cpp
    src/chat/ChatClient.cpp
    src/image/ImageGen.cpp
    src/video/VideoGen.cpp
    src/fileio/FileIO.cpp
)

add_executable(local_ai ${SOURCES})

target_include_directories(local_ai PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/third_party   # nlohmann/json.hpp lives here
    ${CURL_INCLUDE_DIRS}
)

target_link_libraries(local_ai PRIVATE ${CURL_LIBRARIES})

# ── Windows: copy curl DLL next to the executable ────────────────────────────
if(WIN32)
    add_custom_command(TARGET local_ai POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:CURL::libcurl>
            $<TARGET_FILE_DIR:local_ai>
        COMMENT "Copying libcurl DLL"
    )
endif()

# ── Create output directories at build time ───────────────────────────────────
add_custom_command(TARGET local_ai POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory
        ${CMAKE_BINARY_DIR}/outputs/chats
        ${CMAKE_BINARY_DIR}/outputs/images
        ${CMAKE_BINARY_DIR}/outputs/videos
    COMMENT "Creating output directories"
)

message(STATUS "Build type : ${CMAKE_BUILD_TYPE}")
message(STATUS "CURL found : ${CURL_VERSION_STRING}")
