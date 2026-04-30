# syntax=docker/dockerfile:1.6
#
# coagent/agent:claude — per-agent sandbox image.
#
# Each agent runs in its own container of this image. The orchestrator's
# ContainerManager spawns N of these and attaches via Docker stdin/stdout.
#
# Auth: ANTHROPIC_API_KEY is injected at runtime by ContainerManager.
# General internet egress is allowed so agents can run npm/pip/git/curl.

FROM node:22-bookworm-slim

# Tools commonly used by agents during tasks.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      jq \
      python3 \
      python3-pip \
      ripgrep \
      tini \
      uuid-runtime \
      vim-tiny \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally so it's on PATH.
RUN npm install -g @anthropic-ai/claude-code

# Non-root agent user. UID 1000 matches the typical host user so bind-mount
# permissions line up cleanly without chmod gymnastics.
RUN useradd -m -u 1000 -s /bin/bash agent

USER agent
WORKDIR /workspace

# Default shell environment.
ENV SHELL=/bin/bash \
    HOME=/home/agent \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TERM=xterm-256color
# ANTHROPIC_API_KEY is injected at runtime; not baked into the image.

# tini handles PID 1 / signal forwarding so Ctrl+C reaches the shell cleanly.
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default to an interactive bash. The orchestrator attaches via Docker stdin
# and writes `claude --dangerously-skip-permissions --model haiku` once ready.
CMD ["/bin/bash", "-l"]
