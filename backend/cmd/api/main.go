package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"postcode/backend/internal/config"
	"postcode/backend/internal/database"
	"postcode/backend/internal/domain"
	"postcode/backend/internal/httpapi"
	"postcode/backend/internal/notification"
	"postcode/backend/internal/observability"
	"postcode/backend/internal/persistence"
)

func main() { os.Exit(run()) }

func run() int {
	logger := observability.New(slog.LevelInfo)

	if len(os.Args) > 1 && os.Args[1] == "notify-demo" {
		demoPort := "8082"
		if p := os.Getenv("NOTIFICATION_DEMO_PORT"); p != "" {
			demoPort = p
		}
		demoServer := notification.NewDemoServer(logger)
		srv := &http.Server{
			Addr:         ":" + demoPort,
			Handler:      demoServer.Handler(),
			ReadTimeout:  10 * time.Second,
			WriteTimeout: 15 * time.Second,
		}
		logger.Info("Starting notification demo server", "port", demoPort)
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer stop()
		go func() {
			<-ctx.Done()
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = srv.Shutdown(shutdownCtx)
		}()
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("Demo server error", "error", err.Error())
			return 1
		}
		return 0
	}

	cfg, err := config.Load()
	if err != nil {
		logger.Error("Invalid configuration", "error", err.Error())
		return 1
	}
	logger = observability.New(cfg.LogLevel)
	if len(os.Args) > 1 {
		if len(os.Args) != 3 || os.Args[1] != "migrate" || (os.Args[2] != "up" && os.Args[2] != "version") {
			logger.Error("Usage: api [migrate up|version | notify-demo]")
			return 1
		}
		version, dirty, err := database.Migrate(cfg.DatabaseURL, os.Args[2])
		if err != nil {
			logger.Error("Migration error", "error", err.Error())
			return 1
		}
		logger.Info("Migration version", "version", version, "dirty", dirty)
		if dirty {
			return 1
		}
		return 0
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Apply database migrations automatically on service startup
	if version, dirty, err := database.Migrate(cfg.DatabaseURL, "up"); err != nil {
		logger.Warn("Auto-migration notice", "error", err.Error())
	} else {
		logger.Info("Database schema up to date", "version", version, "dirty", dirty)
	}

	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("Database setup failed", "error", err.Error())
		return 1
	}
	defer pool.Close()

	policyPath := "queue_policy.yaml"
	if p := os.Getenv("QUEUE_POLICY_PATH"); p != "" {
		policyPath = p
	}
	policyCfg, err := domain.LoadQueuePolicyFile(policyPath)
	if err != nil {
		logger.Warn("Failed to load queue policy file, using default", "path", policyPath, "error", err.Error())
		policyCfg = domain.DefaultQueuePolicy()
	} else {
		logger.Info("Queue policy loaded", "version", policyCfg.PolicyVersion, "path", policyPath)
	}

	usecases := persistence.New(pool, policyCfg)

	// Background hot-reload of queue_policy.yaml
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		var lastMod time.Time
		if fi, err := os.Stat(policyPath); err == nil {
			lastMod = fi.ModTime()
		}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if fi, err := os.Stat(policyPath); err == nil && fi.ModTime().After(lastMod) {
					lastMod = fi.ModTime()
					if reloaded, err := domain.LoadQueuePolicyFile(policyPath); err == nil {
						usecases.SetPolicy(reloaded)
						logger.Info("Queue policy hot-reloaded successfully", "version", reloaded.PolicyVersion)
					} else {
						logger.Warn("Failed to hot-reload invalid queue policy file", "error", err.Error())
					}
				}
			}
		}
	}()

	// Background recovery worker: reconcile stale CALLED tickets
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				recCtx, recCancel := context.WithTimeout(ctx, 4*time.Second)
				if err := usecases.ReconcileStaleTickets(recCtx, time.Now().UTC()); err != nil && !errors.Is(err, context.Canceled) {
					logger.Warn("ReconcileStaleTickets warning", "error", err.Error())
				}
				recCancel()
			}
		}
	}()

	// Background notification outbox worker. Individual optional adapters decide
	// whether they are configured; an absent demo receiver must not disable SMTP,
	// Telegram, or Web Push.
	{
		sender := notification.NewMultiSender(cfg.NotificationProviderURL, cfg.NotificationTimeout)
		workerCfg := notification.WorkerConfig{
			PollInterval:   cfg.NotificationRetryInterval,
			InitialBackoff: cfg.NotificationRetryInterval,
			MaxAttempts:    cfg.NotificationMaxAttempts,
			BatchSize:      10,
		}
		worker := notification.NewOutboxWorker(usecases, sender, logger, workerCfg)
		go worker.Start(ctx)
		notification.StartTelegramPoller(ctx, usecases, logger)
		logger.Info("Notification outbox worker started",
			"provider_url", cfg.NotificationProviderURL,
			"timeout", cfg.NotificationTimeout,
			"poll_interval", cfg.NotificationRetryInterval,
			"max_attempts", cfg.NotificationMaxAttempts,
		)
	}

	server := &http.Server{Addr: ":" + cfg.HTTPPort, Handler: httpapi.NewRouter(pool, usecases, logger, cfg.AllowedOrigin), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	serverErr := make(chan error, 1)
	go func() { serverErr <- server.ListenAndServe() }()
	logger.Info("HTTP server starting", "port", cfg.HTTPPort, "environment", cfg.AppEnv)
	select {
	case err := <-serverErr:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP server failed", "error", fmt.Sprint(err))
			return 1
		}
	case <-ctx.Done():
		logger.Info("HTTP server shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			logger.Error("Graceful shutdown timed out")
			_ = server.Close()
		}
	}
	return 0
}
