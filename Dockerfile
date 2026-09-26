FROM node:20-alpine

# Security: run as non-root user
RUN addgroup -g 1001 -S botgroup && adduser -u 1001 -S botuser -G botgroup

WORKDIR /app

# Copy package files first (layer cache optimization)
COPY package*.json ./

# Install production dependencies only
# Note: npm ci requires package-lock.json; use npm install --omit=dev as the portable fallback
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi && npm cache clean --force

# Copy source (node_modules excluded by .dockerignore)
COPY . .

# Prisma client generation
RUN npx prisma generate || true

# Switch to non-root user
USER botuser

EXPOSE 3000

CMD ["npm", "run", "start"]
