# This dockerfile builds an image for the backend package.
# It should be executed with the root of the repo as docker context.
#
# Before building this image, be sure to have run the following commands in the repo root:
#
# yarn install --immutable
# yarn tsc
# yarn build:backend

FROM node:24-trixie-slim

# Set Python interpreter for node-gyp
ENV PYTHON=/usr/bin/python3

# Dependencies for Backstage + TechDocs
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get -o Acquire::Retries=5 update && \
    apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
      g++ \
      build-essential \
      libsqlite3-dev \
      graphviz \
    && rm -rf /var/lib/apt/lists/*

# -------------------------------------------------------------------
# TechDocs / MkDocs
# -------------------------------------------------------------------

ENV VIRTUAL_ENV=/opt/venv

RUN python3 -m venv ${VIRTUAL_ENV}

ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir mkdocs-techdocs-core

# -------------------------------------------------------------------
# Directorios Backstage
# -------------------------------------------------------------------

RUN mkdir -p \
      /app/data \
      /app/packages/app \
      /app/packages/backend \
    && chown -R node:node /app

# From here on we use the least-privileged node user.
USER node

WORKDIR /app

# Copy files needed by Yarn
COPY --chown=node:node .yarn ./.yarn
COPY --chown=node:node .yarnrc.yml ./
COPY --chown=node:node backstage.json ./

ENV NODE_ENV=production
ENV NODE_OPTIONS="--no-node-snapshot"

# Copy repo skeleton
COPY --chown=node:node yarn.lock package.json packages/backend/dist/skeleton.tar.gz ./

RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"

# Include examples
COPY --chown=node:node examples ./examples

# Copy backend bundle and configs
COPY --chown=node:node packages/backend/dist/bundle.tar.gz app-config*.yaml ./

RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]