# TRIM

*Track, Record, Inspect, Measure*

A fast, private food, weight and body measurement tracker for phone and desktop. See [SPEC.md](SPEC.md) for what is being built and [TASKS.md](TASKS.md) for progress.

## Layout
- `web/`: React 19, TypeScript, Vite, Tailwind CSS, TanStack Query
- `api/`: FastAPI (Python 3.12), SQLAlchemy 2, Alembic, Postgres

## Local development
Requirements: Node 18.18 or newer (CI uses 22), [uv](https://docs.astral.sh/uv/), Docker.

```bash
docker compose up -d db
```

Postgres listens on host port 5433, so it never clashes with a local install on 5432. On first start, `db/init/01-roles.sql` creates the roles: `trim` owns the schema and runs migrations, and `trim_api` is the API's login. It inherits `trim_app`, which has table privileges but no BYPASSRLS, so row-level security always applies.

```bash
cd api && uv sync && uv run alembic upgrade head && uv run uvicorn app.main:app --reload
```

The API tests need that database. Each run creates a fresh `trim_test` database.

```bash
cd web && npm install && npm run dev
```

The Vite dev server proxies `/api` to the API on port 8000, so the app and API share one origin, as in production.

## Checks
- Web: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`
- API: `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy`, `uv run pytest`
