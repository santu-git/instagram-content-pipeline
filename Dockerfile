FROM node:20-slim

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y \
    chromium \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libx11-xcb1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY scripts/ ./scripts/
COPY templates/ ./templates/
COPY preview-ui/ ./preview-ui/
COPY mcp/ ./mcp/

RUN mkdir -p data output/posts

EXPOSE 3000

CMD ["node", "scripts/preview-server.js"]
