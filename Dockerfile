FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=8080 CAREE_DB=/data/caree.db
EXPOSE 8080
CMD ["node", "--no-warnings", "src/server.js"]
