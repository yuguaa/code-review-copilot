FROM grafana/tempo:3.1.0 AS tempo-source
FROM otel/opentelemetry-collector-contrib:0.162.0 AS collector-source

FROM alpine:3.24.2 AS runtime
RUN apk add --no-cache ca-certificates && addgroup -g 10001 telemetry && adduser -D -u 10001 -G telemetry telemetry

FROM runtime AS tempo
COPY --from=tempo-source /tempo /usr/local/bin/tempo
RUN mkdir -p /var/tempo && chown telemetry:telemetry /var/tempo
USER telemetry
ENTRYPOINT ["/usr/local/bin/tempo"]

FROM runtime AS collector
COPY --from=collector-source /otelcol-contrib /usr/local/bin/otelcol-contrib
USER telemetry
ENTRYPOINT ["/usr/local/bin/otelcol-contrib"]
