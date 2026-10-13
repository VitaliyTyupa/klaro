FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS build
RUN npm install --global npm@12.0.2
WORKDIR /app
COPY . .
RUN npm ci && npm run build
FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/dist ./dist
COPY --from=build /app/tools/migrate.mjs /app/tools/start-deployment.mjs /app/tools/serve-deployment.mjs /app/tools/deletion-journal.mjs ./tools/
COPY --from=build /app/migrations ./migrations
RUN mkdir /var/lib/klaro-journal && chown node:node /var/lib/klaro-journal
USER node
CMD ["node", "tools/start-deployment.mjs"]
