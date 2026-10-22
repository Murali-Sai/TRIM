# The API image, run on Render (task 5.5; render.yaml). Render sets PORT; the app reads TRIM_*
# settings from the environment (secrets are set in Render, never in the image).
# Google's Docker Hub mirror: no pull limits on GitHub runners.
FROM mirror.gcr.io/library/python:3.12-slim-bookworm AS build
RUN pip install --no-cache-dir "uv>=0.8,<0.9"
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY alembic.ini ./
COPY app ./app
COPY migrations ./migrations

FROM mirror.gcr.io/library/python:3.12-slim-bookworm
RUN useradd --system --uid 10001 --no-create-home trim
WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PORT=8080
USER trim
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --no-server-header"]
