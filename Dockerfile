FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
# Cài thư viện + trình duyệt Chromium (kèm thư viện hệ thống) cho Playwright
RUN npm install --omit=dev --no-audit --no-fund && npx playwright install --with-deps chromium
COPY server.js ./
COPY dvc ./dvc
COPY public ./public
COPY src ./src
COPY schemas ./schemas
COPY config ./config
RUN mkdir -p data
ENV DVC_HEADLESS=1
EXPOSE 3000
CMD ["node", "server.js"]
