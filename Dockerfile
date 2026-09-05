# syntax=docker/dockerfile:1

FROM node:20-alpine AS base

WORKDIR /app

ENV HUSKY=0
ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_VERSION=9.15.9

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/landing/package.json ./apps/landing/package.json
COPY apps/widgets/package.json ./apps/widgets/package.json
COPY apps/admin-panel/package.json ./apps/admin-panel/package.json
COPY apps/crm/package.json ./apps/crm/package.json
COPY packages/winwidget-web/package.json ./packages/winwidget-web/package.json
RUN pnpm install --frozen-lockfile

FROM base AS builder

COPY --from=deps /app/ ./
COPY . .

# Required: one build produces one independently deployable application.
ARG FRONTEND_APP
ARG NEXT_PUBLIC_MODE=production
ARG NEXT_PUBLIC_SITE_URL=https://winwidget.ru
ARG NEXT_PUBLIC_PRODUCTION_HOST=https://api.winwidget.ru
ARG NEXT_PUBLIC_WIDGETS_HOST=
ARG NEXT_PUBLIC_API_URL=https://api.winwidget.ru/api/v1
ARG NEXT_PUBLIC_RECAPTCHA_SITE_KEY=
ARG NEXT_PUBLIC_RECAPTCHA_HOST=https://www.recaptcha.net
ARG NEXT_PUBLIC_APP_URL=https://crm.winwidget.ru
ARG NEXT_PUBLIC_MAIN_APP_URL=https://winwidget.ru
ARG NEXT_PUBLIC_WINCRM_ENABLED=false
ARG NEXT_PUBLIC_WINCRM_BILLING_ENABLED=false

ENV NEXT_PUBLIC_MODE=${NEXT_PUBLIC_MODE}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_PRODUCTION_HOST=${NEXT_PUBLIC_PRODUCTION_HOST}
ENV NEXT_PUBLIC_WIDGETS_HOST=${NEXT_PUBLIC_WIDGETS_HOST}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_RECAPTCHA_SITE_KEY=${NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
ENV NEXT_PUBLIC_RECAPTCHA_HOST=${NEXT_PUBLIC_RECAPTCHA_HOST}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_MAIN_APP_URL=${NEXT_PUBLIC_MAIN_APP_URL}
ENV NEXT_PUBLIC_WINCRM_ENABLED=${NEXT_PUBLIC_WINCRM_ENABLED}
ENV NEXT_PUBLIC_WINCRM_BILLING_ENABLED=${NEXT_PUBLIC_WINCRM_BILLING_ENABLED}

# Only dependency installation may use the network. Prerendering must not
# contact production APIs, OAuth, payment providers or external font services.
RUN --network=none set -eu; \
	case "$FRONTEND_APP" in landing|widgets|admin-panel|crm) ;; *) exit 64 ;; esac; \
	case "$NEXT_PUBLIC_WINCRM_ENABLED" in true|false) ;; *) exit 64 ;; esac; \
	case "$NEXT_PUBLIC_WINCRM_BILLING_ENABLED" in true|false) ;; *) exit 64 ;; esac; \
	pnpm --filter "./apps/${FRONTEND_APP}" run build; \
	mkdir -p "apps/${FRONTEND_APP}/public"

FROM node:20-alpine AS runner

WORKDIR /app

ARG FRONTEND_APP
ARG APP_REVISION

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV FRONTEND_APP=${FRONTEND_APP}
ENV APP_REVISION=${APP_REVISION}

LABEL org.opencontainers.image.revision="${APP_REVISION}" \
	ru.winwidget.frontend.app="${FRONTEND_APP}"

RUN addgroup -S -g 1001 nodejs \
	&& adduser -S -D -H -u 1001 -G nodejs nextjs

# Keep the monorepo server.js location used by Next output tracing. Never copy
# the workspace node_modules, neighbouring apps, or shared public into runtime.
COPY --from=builder --chown=nextjs:nodejs /app/apps/${FRONTEND_APP}/.next/standalone/ ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/${FRONTEND_APP}/.next/static/ ./apps/${FRONTEND_APP}/.next/static/
COPY --from=builder --chown=nextjs:nodejs /app/apps/${FRONTEND_APP}/public/ ./apps/${FRONTEND_APP}/public/
COPY --from=builder --chown=nextjs:nodejs /app/scripts/container-entrypoint.mjs ./container-entrypoint.mjs

USER nextjs
RUN --network=none node container-entrypoint.mjs --verify

EXPOSE 3000

CMD ["node", "container-entrypoint.mjs"]
