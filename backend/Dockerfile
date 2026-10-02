FROM golang:1.25-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/api ./cmd/api

FROM alpine:3.22
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata && adduser -D app
COPY --from=build /out/api /app/api
COPY migrations /app/migrations
COPY queue_policy.yaml /app/queue_policy.yaml
USER app
ENTRYPOINT ["/app/api"]
