# Build stage
FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY . .
RUN CGO_ENABLED=0 go build -o fvnli-discord-bot .

# Final stage - empty container
FROM scratch
COPY --from=builder /app/fvnli-discord-bot /fvnli-discord-bot
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /bin/false /bin/false
CMD ["/fvnli-discord-bot"]
