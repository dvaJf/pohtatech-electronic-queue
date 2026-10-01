package observability

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

// InitTracer initializes OpenTelemetry TracerProvider with an OTLP HTTP exporter.
// If endpoint is empty or "none", it defaults to a noop tracer.
func InitTracer(ctx context.Context, serviceName, environment, endpoint string, logger *slog.Logger) (func(context.Context) error, error) {
	if endpoint == "" {
		endpoint = os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	}

	if endpoint == "" || strings.EqualFold(endpoint, "none") {
		otel.SetTracerProvider(noop.NewTracerProvider())
		otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
			propagation.TraceContext{},
			propagation.Baggage{},
		))
		logger.Info("OpenTelemetry tracer disabled (endpoint not configured)")
		return func(context.Context) error { return nil }, nil
	}

	// Clean endpoint if it contains protocol prefix for otlptracehttp
	opts := []otlptracehttp.Option{
		otlptracehttp.WithTimeout(5 * time.Second),
	}

	endpointClean := endpoint
	insecure := true
	if strings.HasPrefix(endpoint, "http://") {
		endpointClean = strings.TrimPrefix(endpoint, "http://")
		insecure = true
	} else if strings.HasPrefix(endpoint, "https://") {
		endpointClean = strings.TrimPrefix(endpoint, "https://")
		insecure = false
	}

	opts = append(opts, otlptracehttp.WithEndpoint(endpointClean))
	if insecure {
		opts = append(opts, otlptracehttp.WithInsecure())
	}

	exporter, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create OTLP trace exporter: %w", err)
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceNameKey.String(serviceName),
			semconv.DeploymentEnvironmentKey.String(environment),
		),
		resource.WithHost(),
		resource.WithProcess(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create trace resource: %w", err)
	}

	bsp := sdktrace.NewBatchSpanProcessor(exporter)
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithResource(res),
		sdktrace.WithSpanProcessor(bsp),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	logger.Info("OpenTelemetry tracer initialized", "service", serviceName, "endpoint", endpoint)

	return func(shutdownCtx context.Context) error {
		return tp.Shutdown(shutdownCtx)
	}, nil
}

// Tracer returns the global tracer for the specified name.
func Tracer(name string) trace.Tracer {
	return otel.GetTracerProvider().Tracer(name)
}
