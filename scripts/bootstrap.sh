#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/bin/coagent-cli"
NVM_VERSION="v0.40.1"
NODE_VERSION="22"
SETUP_MARKER="$ROOT/.coagent-setup-done"
AUTH_FILE="$ROOT/.coagent-auth"
HONCHO_DIR=""
UV=""

log() { printf '  \033[0;36m▸\033[0m %s\n' "$1"; }
ok() { printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[0;33m!\033[0m %s\n' "$1"; }
fail() { printf '  \033[0;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

env_value() {
  local key="$1"
  local file="$ROOT/.env"
  local value

  [ -f "$file" ] || return 0
  value="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  touch "$file"
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { written = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      written = 1
      next
    }
    { print }
    END {
      if (written == 0) {
        print key "=" value
      }
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
  fi
}

ensure_env_file() {
  if [ ! -f "$ROOT/.env" ]; then
    fail ".env not found. Create it first: cp .env.example .env, then fill in your API keys."
  fi
  ok ".env found"
}

ensure_node() {
  load_nvm

  local node_major=""
  if command -v node >/dev/null 2>&1; then
    node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || true)"
  fi

  if [[ "$node_major" =~ ^[0-9]+$ ]] && [ "$node_major" -ge 20 ] && [ "$node_major" -le 24 ]; then
    ok "Node.js $(node -v)"
    return
  fi

  warn "Node.js v20-v24 not found; installing Node.js $NODE_VERSION with nvm"
  if [ ! -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    log "Installing nvm $NVM_VERSION"
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" -o /tmp/coagent-nvm-install.sh
    bash /tmp/coagent-nvm-install.sh
  fi

  load_nvm
  command -v nvm >/dev/null 2>&1 || fail "nvm installed but not loadable. Open a new terminal and retry."

  nvm install "$NODE_VERSION"
  nvm use "$NODE_VERSION"

  node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || true)"
  if [[ "$node_major" =~ ^[0-9]+$ ]] && [ "$node_major" -ge 20 ] && [ "$node_major" -le 24 ]; then
    ok "Node.js $(node -v)"
  else
    fail "Node.js installation did not produce a supported version."
  fi
}

ensure_docker() {
  local docker_app=""
  local docker_bin_dir=""
  local compose_plugin=""

  if [ -d "/Applications/Docker.app" ]; then
    docker_app="/Applications/Docker.app"
  elif [ -d "$HOME/Applications/Docker.app" ]; then
    docker_app="$HOME/Applications/Docker.app"
  fi

  if [ -n "$docker_app" ] && [ -x "$docker_app/Contents/Resources/bin/docker" ]; then
    docker_bin_dir="$docker_app/Contents/Resources/bin"
    export PATH="$docker_bin_dir:$PATH"
  fi

  if ! command -v docker >/dev/null 2>&1; then
    if [ -n "$docker_app" ]; then
      fail "Docker Desktop exists at $docker_app, but its docker CLI was not found. Reinstall Docker Desktop or enable its command-line tools."
    elif [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
      warn "Docker CLI not found; installing Docker Desktop with Homebrew"
      brew install --cask docker
      if [ -d "/Applications/Docker.app" ] && [ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]; then
        export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
      fi
    else
      fail "Docker not found. Install Docker Desktop, then rerun make start."
    fi
  fi

  if ! command -v docker >/dev/null 2>&1; then
    fail "Docker was installed, but the docker CLI is still not available."
  fi

  if ! docker compose version >/dev/null 2>&1; then
    if [ -n "$docker_app" ] && [ -x "$docker_app/Contents/Resources/cli-plugins/docker-compose" ]; then
      warn "Docker Compose plugin not found on PATH; linking Docker Desktop's plugin"
      compose_plugin="$HOME/.docker/cli-plugins/docker-compose"
      mkdir -p "$(dirname "$compose_plugin")"
      ln -sf "$docker_app/Contents/Resources/cli-plugins/docker-compose" "$compose_plugin"
    fi

    docker compose version >/dev/null 2>&1 || fail "Docker Compose is not available. Install/repair Docker Desktop, then rerun make start."
  fi

  if docker info >/dev/null 2>&1; then
    ok "Docker is running"
    return
  fi

  if [ "$(uname -s)" = "Darwin" ]; then
    warn "Docker Desktop is not running; opening it now"
    if [ -n "$docker_app" ]; then
      open "$docker_app" >/dev/null 2>&1 || true
    else
      open -a Docker >/dev/null 2>&1 || true
    fi
    for _ in {1..90}; do
      if docker info >/dev/null 2>&1; then
        ok "Docker is running"
        return
      fi
      sleep 2
    done
  fi

  fail "Docker Desktop did not become ready. Finish any Docker Desktop prompts, then rerun make start."
}

find_honcho() {
  local candidate
  for candidate in \
    "${COAGENT_HONCHO_DIR:-}" \
    "$ROOT/../honcho" \
    "$ROOT/../../honcho"; do
    if [ -n "$candidate" ] && [ -f "$candidate/src/main.py" ] && [ -f "$candidate/pyproject.toml" ] && [ -f "$candidate/alembic.ini" ]; then
      HONCHO_DIR="$(cd "$candidate" && pwd)"
      return 0
    fi
  done
  return 1
}

ensure_honcho() {
  if find_honcho; then
    ok "Honcho found at $HONCHO_DIR"
    export COAGENT_HONCHO_DIR="$HONCHO_DIR"
    return
  fi

  HONCHO_DIR="$(cd "$ROOT/.." && pwd)/honcho"
  if [ -e "$HONCHO_DIR" ]; then
    fail "$HONCHO_DIR already exists but does not look like Honcho. Set COAGENT_HONCHO_DIR=/path/to/honcho or move that directory."
  fi

  warn "Honcho not found; cloning to $HONCHO_DIR"
  git clone https://github.com/plastic-labs/honcho.git "$HONCHO_DIR"
  export COAGENT_HONCHO_DIR="$HONCHO_DIR"
  ok "Honcho cloned"
}

ensure_auth() {
  local anthropic_api_key
  anthropic_api_key="$(env_value ANTHROPIC_API_KEY)"

  if [ -z "$anthropic_api_key" ]; then
    anthropic_api_key="$(env_value LLM_ANTHROPIC_API_KEY)"
  fi

  if [ -z "$anthropic_api_key" ]; then
    fail "ANTHROPIC_API_KEY is empty in .env. Add it before running make start."
  fi

  printf 'ANTHROPIC_API_KEY=%s\n' "$anthropic_api_key" > "$AUTH_FILE"
  chmod 600 "$AUTH_FILE"
  ok "Anthropic API key configured"
}

ensure_honcho_env() {
  local honcho_env="$HONCHO_DIR/.env"
  local anthropic_api_key
  local gemini_api_key
  local embedding_provider

  if [ ! -f "$honcho_env" ]; then
    cp "$ROOT/.env" "$honcho_env"
  fi

  anthropic_api_key="$(env_value ANTHROPIC_API_KEY)"
  [ -z "$anthropic_api_key" ] && anthropic_api_key="$(env_value LLM_ANTHROPIC_API_KEY)"
  upsert_env "$honcho_env" "LLM_ANTHROPIC_API_KEY" "$anthropic_api_key"

  gemini_api_key="$(env_value LLM_GEMINI_API_KEY)"
  embedding_provider="$(env_value LLM_EMBEDDING_PROVIDER)"
  if [ -n "$gemini_api_key" ]; then
    upsert_env "$honcho_env" "LLM_GEMINI_API_KEY" "$gemini_api_key"
  elif [ "$embedding_provider" = "gemini" ] || [ -z "$embedding_provider" ]; then
    warn "LLM_GEMINI_API_KEY is empty; semantic recall may not work until it is set."
  fi

  ok "Honcho .env configured"
}

ensure_uv() {
  if [ -x "$HOME/.local/bin/uv" ]; then
    UV="$HOME/.local/bin/uv"
  elif command -v uv >/dev/null 2>&1; then
    UV="$(command -v uv)"
  else
    warn "uv not found; installing uv"
    curl -LsSf https://astral.sh/uv/install.sh -o /tmp/coagent-uv-install.sh
    sh /tmp/coagent-uv-install.sh
    UV="$HOME/.local/bin/uv"
  fi

  [ -x "$UV" ] || fail "uv installed but not found at $UV"
  ok "uv ready"
}

ensure_node_deps() {
  if [ -d "$ROOT/node_modules" ] && [ -d "$ROOT/backend/node_modules" ] && [ -d "$ROOT/frontend/node_modules" ]; then
    ok "Node dependencies ready"
    return
  fi

  warn "Installing Node dependencies"
  (cd "$ROOT" && npm install)
  (cd "$ROOT/backend" && npm install)
  (cd "$ROOT/frontend" && npm install)
  ok "Node dependencies installed"
}

ensure_honcho_deps() {
  if [ -d "$HONCHO_DIR/.venv" ]; then
    ok "Honcho Python dependencies ready"
    return
  fi

  warn "Installing Honcho Python dependencies"
  (cd "$HONCHO_DIR" && "$UV" sync)
  ok "Honcho Python dependencies installed"
}

ensure_agent_image() {
  local mode="${COAGENT_MODE:-container}"

  if [ "$mode" != "container" ]; then
    return
  fi

  warn "Building agent image coagent/agent:claude"
  docker build -t coagent/agent:claude -f "$ROOT/agent/Dockerfile" "$ROOT/agent"
  ok "Agent image built"
}

bootstrap() {
  echo ""
  log "Bootstrapping CoAgent"
  ensure_env_file
  ensure_node
  ensure_docker
  ensure_honcho
  ensure_auth
  ensure_honcho_env
  ensure_uv
  ensure_node_deps
  ensure_honcho_deps
  ensure_agent_image
  touch "$SETUP_MARKER"
  ok "Bootstrap complete"
  echo ""
}

case "${1:-bootstrap}" in
  bootstrap|check)
    bootstrap
    ;;
  start)
    bootstrap
    exec "$CLI"
    ;;
  *)
    fail "Unknown bootstrap command: $1"
    ;;
esac
