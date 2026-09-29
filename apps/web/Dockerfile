FROM node:24-alpine AS dependencies

RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS development
COPY apps/web apps/web
COPY packages packages
EXPOSE 5173
CMD ["pnpm", "--filter", "@paper-stock/web", "dev"]

FROM dependencies AS build
COPY apps/web apps/web
COPY packages packages
RUN pnpm --filter @paper-stock/web build

FROM nginx:1.29-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80

