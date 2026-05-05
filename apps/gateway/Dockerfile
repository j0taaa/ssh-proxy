FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY apps/gateway apps/gateway
COPY packages/protocol packages/protocol
RUN npm run build --workspace packages/protocol && npm run build --workspace apps/gateway
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/gateway/package.json apps/gateway/package.json
COPY --from=build /app/apps/gateway/dist apps/gateway/dist
COPY --from=build /app/packages/protocol/package.json packages/protocol/package.json
COPY --from=build /app/packages/protocol/dist packages/protocol/dist

EXPOSE 3001
CMD ["npm", "run", "start", "--workspace", "apps/gateway"]
