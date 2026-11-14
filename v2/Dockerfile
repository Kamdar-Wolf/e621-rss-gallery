FROM node:22-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY db ./db
RUN npm run build
ENV NODE_ENV=production
USER node
CMD ["node","dist/apps/api/src/server.js"]
