FROM node:20-alpine AS build

WORKDIR /repo
COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci --workspace @ultrawiki/api --include-workspace-root=false

COPY api ./api
COPY infra/evaluation ./infra/evaluation
COPY infra/prompts ./infra/prompts
WORKDIR /repo/api
RUN npm run build
RUN npm prune --omit=dev --workspace @ultrawiki/api --include-workspace-root=false

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/api/package.json ./api/package.json
COPY --from=build /repo/api/dist ./api/dist
COPY --from=build /repo/api/fixtures ./api/fixtures
COPY --from=build /repo/infra/evaluation ./infra/evaluation
COPY --from=build /repo/infra/prompts ./infra/prompts

WORKDIR /repo/api
EXPOSE 4000
CMD ["npm", "run", "start"]
