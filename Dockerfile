# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM ubuntu:24.04 AS builder

# Avoid interactive prompts during apt installs
ENV DEBIAN_FRONTEND=noninteractive

# Install build tools
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    curl \
    libcurl4-openssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Download nlohmann/json single header
RUN mkdir -p /app/third_party/nlohmann && \
    curl -L -o /app/third_party/nlohmann/json.hpp \
    https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp

# Copy source code
WORKDIR /app
COPY CMakeLists.txt .
COPY src/ src/

# Build
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build --parallel

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Only runtime dependency needed
RUN apt-get update && apt-get install -y \
    libcurl4 \
    && rm -rf /var/lib/apt/lists/*

# Copy the built binary from stage 1
COPY --from=builder /app/build/bin/local_ai /usr/local/bin/local_ai

# Create output directories
RUN mkdir -p /outputs/chats /outputs/images /outputs/videos

WORKDIR /outputs

# Run the assistant
CMD ["local_ai"]
