FROM node:22-alpine
WORKDIR /app
COPY package.json build.js test.js ./
COPY src ./src
COPY server ./server
COPY dist ./dist
RUN node build.js && mkdir -p /data
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
VOLUME /data
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "--no-warnings", "server/server.js"]
