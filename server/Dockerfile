FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./
ENV NODE_ENV=production
ENV DATA_DIR=/data
RUN mkdir -p /data && addgroup -S app && adduser -S app -G app && chown -R app:app /app /data
USER app
EXPOSE 3535
ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","src/index.js"]
