FROM node:24-alpine
WORKDIR /app
COPY server.mjs .
ENV PORT=8080
ENV CVAT_STORE=/store
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
