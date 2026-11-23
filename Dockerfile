# Talesreach game server. Build from the repo root:
#   docker build -t talesreach-server .
#   docker run -p 2567:2567 talesreach-server
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace shared --workspace server --include-workspace-root
COPY shared shared
COPY server server
RUN npm run build --workspace shared && npm run build --workspace server

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace shared --workspace server
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
# Maps: the server uses the same Tiled maps as the client for collision.
COPY assets/maps assets/maps
EXPOSE 2567
USER node
CMD ["node", "server/dist/index.js"]
