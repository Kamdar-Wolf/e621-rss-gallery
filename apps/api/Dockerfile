FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --no-audit --no-fund
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src
COPY apps/api/migrations apps/api/migrations
RUN npm run build -w @kamdar/api
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
