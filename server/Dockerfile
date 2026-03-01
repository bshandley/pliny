FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
ARG CACHE_BUST=unknown
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/migrations/*.sql ./dist/migrations/
EXPOSE 3001
CMD ["sh", "-c", "node dist/migrations/run.js && node dist/index.js"]
