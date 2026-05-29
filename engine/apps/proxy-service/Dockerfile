# ── Stage 1: Builder ────────────────────────────────────
FROM python:3.12-slim AS builder

ARG INSTALL_PROFILE=self-hosted
ARG TORCH_VERSION=2.10.0
ARG PYTORCH_CPU_INDEX_URL=https://download.pytorch.org/whl/cpu

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential g++ \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml requirements-self-hosted.txt ./
RUN pip install --no-cache-dir uv && \
    if [ "$INSTALL_PROFILE" = "self-hosted" ]; then \
      ARCH="$(python -c 'import platform; print(platform.machine())')" && \
      if [ "$ARCH" = "x86_64" ]; then \
        uv pip install --system --no-cache --index-url "$PYTORCH_CPU_INDEX_URL" "torch==${TORCH_VERSION}+cpu"; \
      else \
        uv pip install --system --no-cache --index-url "$PYTORCH_CPU_INDEX_URL" "torch==${TORCH_VERSION}+cpu" || \
        uv pip install --system --no-cache "torch==${TORCH_VERSION}"; \
      fi && \
      uv pip install --system --no-cache -r requirements-self-hosted.txt && \
      uv pip install --system --no-cache --no-deps .; \
    else \
      uv pip install --system --no-cache .; \
    fi

# ── Stage 2: Runtime ────────────────────────────────────
FROM python:3.12-slim

ARG INSTALL_PROFILE=self-hosted

RUN apt-get update && \
    if [ "$INSTALL_PROFILE" = "self-hosted" ]; then \
      apt-get install -y --no-install-recommends libgomp1; \
    else \
      apt-get install -y --no-install-recommends \
        libgomp1 \
        libpango-1.0-0 libpangocairo-1.0-0 libpangoft2-1.0-0 \
        libgdk-pixbuf-2.0-0 libcairo2 libglib2.0-0 \
        fonts-liberation fonts-dejavu-core; \
    fi && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

COPY src/ src/
COPY data/ data/
COPY alembic/ alembic/
COPY alembic.ini .

EXPOSE 8000

# APP_ENTRY selects the FastAPI app module:
#   src.main_self_hosted:app -> local browser-extension engine (default)
#   src.main:app             -> full demo (includes wizard + red-team)
ENV APP_ENTRY=src.main_self_hosted:app
CMD uvicorn $APP_ENTRY --host 0.0.0.0 --port 8000
