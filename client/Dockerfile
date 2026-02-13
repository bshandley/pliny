FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
ARG CACHE_BUST=unknown
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
