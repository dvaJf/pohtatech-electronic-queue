package observability

import (
	"context"
	"log/slog"
	"os"

	"go.opentelemetry.io/otel/trace"
)

type traceHandler struct {
	slog.Handler
}

func (h *traceHandler) Handle(ctx context.Context, r slog.Record) error {
	if ctx != nil {
		span := trace.SpanFromContext(ctx)
		if span.SpanContext().IsValid() {
			r.AddAttrs(
				slog.String("trace_id", span.SpanContext().TraceID().String()),
				slog.String("span_id", span.SpanContext().SpanID().String()),
			)
		}
	}
	return h.Handler.Handle(ctx, r)
}

func (h *traceHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &traceHandler{Handler: h.Handler.WithAttrs(attrs)}
}

func (h *traceHandler) WithGroup(name string) slog.Handler {
	return &traceHandler{Handler: h.Handler.WithGroup(name)}
}

// New creates a structured slog JSON logger with OpenTelemetry trace correlation.
func New(level slog.Level) *slog.Logger {
	base := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: level,
	})
	return slog.New(&traceHandler{Handler: base}).With("service", "backend")
}
