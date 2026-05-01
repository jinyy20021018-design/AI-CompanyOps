.PHONY: help bootstrap setup start start-container start-pty stop restart status logs open dev dev-backend dev-frontend

CLI := ./bin/coagent-cli
BOOTSTRAP := ./scripts/bootstrap.sh

help:
	@echo "CoAgent commands"
	@echo ""
	@echo "  make bootstrap       Check and install local prerequisites"
	@echo "  make setup           Run first-time setup wizard"
	@echo "  make start           Bootstrap, then start CoAgent"
	@echo "  make start-container Start with container sandbox mode"
	@echo "  make start-pty       Start with legacy host PTY mode"
	@echo "  make stop            Stop all services"
	@echo "  make restart         Restart all services"
	@echo "  make status          Show service health"
	@echo "  make logs            Tail service logs"
	@echo "  make open            Open the UI"
	@echo ""
	@echo "Development"
	@echo "  make dev             Run backend and frontend locally"
	@echo "  make dev-backend     Run backend locally"
	@echo "  make dev-frontend    Run frontend locally"

bootstrap:
	$(BOOTSTRAP) bootstrap

setup:
	$(CLI) setup

start:
	$(BOOTSTRAP) start

start-container:
	COAGENT_MODE=container $(BOOTSTRAP) start

start-pty:
	COAGENT_MODE=pty $(BOOTSTRAP) start

stop:
	$(CLI) stop

restart:
	$(CLI) restart

status:
	$(CLI) status

logs:
	$(CLI) logs

open:
	$(CLI) open

dev:
	npm run dev

dev-backend:
	npm run dev:backend

dev-frontend:
	npm run dev:frontend
