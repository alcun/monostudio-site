FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=install /app/node_modules node_modules
COPY . .
RUN bun run build

FROM base AS release
COPY --from=install /app/node_modules node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/astro.config.mjs ./astro.config.mjs

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 4321/tcp

CMD ["bun", "run", "start"]
