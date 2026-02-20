FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tollbooth.config.yaml .

EXPOSE 3000
CMD ["bunx", "tollbooth", "start"]
