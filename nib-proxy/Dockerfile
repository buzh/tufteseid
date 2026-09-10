# Token-injecting sidecar for Norge i bilder ortofoto. Zero deps, so no
# npm install — just the runtime and one file. See server.mjs.
FROM node:24-alpine
WORKDIR /app
COPY server.mjs .
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
