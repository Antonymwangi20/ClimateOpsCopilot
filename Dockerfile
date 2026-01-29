# Multi-stage build for climate-ops-copilot

# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json vite.config.ts ./
COPY components ./components
COPY hooks ./hooks
COPY services ./services
COPY App.tsx index.tsx types.ts ./

RUN npm run build

# Stage 2: Server runtime
FROM node:18-alpine

WORKDIR /app

# Install native dependencies for sharp
RUN apk add --no-cache python3 make g++ cairo-dev jpeg-dev pango-dev giflib-dev pixman-dev

COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY server ./server
COPY --from=frontend-builder /app/dist ./public

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 3000 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["npm", "run", "start-server"]
