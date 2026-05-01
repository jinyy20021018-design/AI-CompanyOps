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

# CoAgent launches Claude Code in fresh per-session directories. Prime the
# per-container Claude config before each launch so first-run TUI prompts do not
# block autonomous agents.
COPY coagent-claude /usr/local/bin/coagent-claude
RUN chmod 755 /usr/local/bin/coagent-claude

# Non-root agent user. UID 1000 matches the typical host user so bind-mount
# permissions line up cleanly without chmod gymnastics. Some Node base images
# already reserve UID 1000, so reuse that account when present.
RUN existing_user="$(getent passwd 1000 | cut -d: -f1)" \
    && if [ -n "$existing_user" ]; then \
      usermod -l agent -d /home/agent -m "$existing_user"; \
    else \
      useradd -m -u 1000 -s /bin/bash agent; \
    fi

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
# and writes `coagent-claude --permission-mode dontAsk --model haiku` once ready.
CMD ["/bin/bash", "-l"]
