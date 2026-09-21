# Tile server for the cached combined-VAT ground: one MBTiles database per
# LiDAR acquisition, one SELECT per tile. Zero deps — node:sqlite is compiled
# into Node 24 — so no npm install, just the runtime and one file. See
# server.mjs.
FROM node:24-alpine
WORKDIR /app
COPY server.mjs .
ENV PORT=8080
ENV CVAT_STORE=/store
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
