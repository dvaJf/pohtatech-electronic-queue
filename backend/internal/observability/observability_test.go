package observability

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestTraceLoggerCorrelation(t *testing.T) {
	var buf bytes.Buffer
	baseHandler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	logger := slog.New(&traceHandler{Handler: baseHandler})

	tp := sdktrace.NewTracerProvider()
	otel.SetTracerProvider(tp)
	tracer := tp.Tracer("test")

	ctx, span := tracer.Start(context.Background(), "test-span")
	defer span.End()

	logger.InfoContext(ctx, "Test log with trace", "key", "value")

	output := buf.String()
	if !strings.Contains(output, `"trace_id"`) {
		t.Fatalf("expected trace_id in log output, got: %s", output)
	}
	if !strings.Contains(output, `"span_id"`) {
		t.Fatalf("expected span_id in log output, got: %s", output)
	}
}

func TestInitTracerNoop(t *testing.T) {
	logger := slog.Default()
	shutdown, err := InitTracer(context.Background(), "test-service", "test", "none", logger)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown error: %v", err)
	}
}
