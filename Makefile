.PHONY: dev backend frontend build fmt down init-db

# Backend + local DynamoDB in Docker; run the frontend separately with `make frontend`.
dev:
	docker compose up -d dynamodb backend
	@echo "Backend on http://localhost:5000  ·  run 'make frontend' in another shell"

frontend:
	cd frontend && npm install && npm run dev

build:
	cd frontend && npm install && npm run build

# Production-like full stack (built frontend served by nginx on :80).
full: build
	docker compose --profile full up -d --build

init-db:
	docker compose exec backend python init_db.py

down:
	docker compose down

fmt:
	cd frontend && npx prettier . --write
