FROM node:20-alpine AS build

WORKDIR /repo
COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci --workspace @ultrawiki/web --include-workspace-root=false

COPY web ./web
WORKDIR /repo/web
RUN npm run build
RUN npm prune --omit=dev --workspace @ultrawiki/web --include-workspace-root=false

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/web/package.json ./web/package.json
COPY --from=build /repo/web/.next ./web/.next
COPY --from=build /repo/web/next.config.js ./web/next.config.js

WORKDIR /repo/web
EXPOSE 3000
CMD ["npm", "run", "start"]
