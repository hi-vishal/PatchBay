# Build context is the repo root, because npm workspaces need the root lockfile.
FROM node:22-alpine AS build
# Tests are not run in this image, so skip downloading a MongoDB binary.
ENV MONGOMS_DISABLE_POSTINSTALL=1
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --include-workspace-root
COPY server server
RUN npm run build --workspace server

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist server/dist
USER node
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "dist/index.js"]
