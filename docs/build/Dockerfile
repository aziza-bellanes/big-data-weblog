FROM docker:27-cli AS docker-cli
FROM node:22-bookworm-slim
# Only Chromium's headless shell is needed for captures and PDF rendering.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN --mount=type=cache,id=weblogs-docs-apt,target=/var/cache/apt \
    --mount=type=cache,id=weblogs-docs-npm,target=/root/.npm \
    rm -f /etc/apt/apt.conf.d/docker-clean \
 && apt-get update && apt-get install -y --no-install-recommends make ca-certificates \
 && npx --yes --package=playwright@1.64.1 playwright install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/*
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
WORKDIR /workspace/docs/build
