# Stage 1: Build
FROM node:18-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Set the API base URL for production to use relative path (proxied by Nginx)
ENV VITE_API_BASE=/api
# Default to production mode (false) - override with --build-arg VITE_DEV_MODE=true for dev
ARG VITE_DEV_MODE=false
ENV VITE_DEV_MODE=$VITE_DEV_MODE
RUN echo "Building with VITE_DEV_MODE=$VITE_DEV_MODE" && npm run build

# Stage 2: Serve
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
