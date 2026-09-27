FROM node:22-alpine
RUN apk add --no-cache openssl && addgroup -g 1001 -S botgroup && adduser -u 1001 -S botuser -G botgroup
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Migration CLI is intentionally installed in the runtime image.
RUN npm ci && npm cache clean --force
COPY . .
RUN mkdir -p /data && chown botuser:botgroup /data
ENV BOT_DATA_DIR=/data
USER botuser
EXPOSE 3000
CMD ["sh", "scripts/railway-start.sh"]
