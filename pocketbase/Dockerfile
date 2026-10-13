FROM alpine:3.20

ARG PB_VERSION=0.40.2

RUN apk add --no-cache ca-certificates unzip wget \
  && wget -O /tmp/pb.zip \
       https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
  && unzip /tmp/pb.zip -d /pb \
  && rm /tmp/pb.zip \
  && chmod +x /pb/pocketbase

EXPOSE 8090

CMD ["/pb/pocketbase", "serve", \
     "--http=0.0.0.0:8090", \
     "--dir=/pb_data", \
     "--migrationsDir=/pb_migrations", \
     "--hooksDir=/pb_hooks", \
     "--hooksWatch=false"]
