package persistence

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func TestTelegramLink_LifecycleAndSecurity(t *testing.T) {
	ctx, p, _ := integration(t)
	tkt := create(t, ctx, p, parcels, "tg-sec-"+time.Now().Format("150405.000000"))
	mgmtCtx := WithManagementToken(WithPublicClient(ctx), "test-token")
	// Save management token hash on ticket so checkNotificationTicketAccess succeeds
	execSQL(t, ctx, p, `UPDATE tickets SET management_token_hash=$1 WHERE id=$2::uuid`, HashManagementToken("test-token"), tkt.ID)

	// 1. Create token
	token, err := p.CreateTelegramLink(mgmtCtx, tkt.ID)
	if err != nil {
		t.Fatalf("CreateTelegramLink failed: %v", err)
	}
	if len(token) < 32 {
		t.Fatalf("expected 256-bit base64 token, got length %d", len(token))
	}

	// Verify raw token is NOT stored in DB, only token_hash
	var storedHash string
	err = p.pool.QueryRow(ctx, `SELECT token_hash FROM telegram_link_tokens WHERE ticket_id=$1::uuid`, tkt.ID).Scan(&storedHash)
	if err != nil {
		t.Fatalf("query token_hash failed: %v", err)
	}
	if storedHash == token {
		t.Fatal("security violation: raw token stored in database!")
	}

	// 2. Consume token creates subscription
	sub, err := p.ConsumeTelegramLink(ctx, token, "123456789")
	if err != nil {
		t.Fatalf("ConsumeTelegramLink failed: %v", err)
	}
	if sub.Channel != domain.NotificationChannelTelegram || sub.Destination != "123456789" || !sub.Enabled {
		t.Fatalf("unexpected subscription: %+v", sub)
	}

	// 3. Second use rejected (one-time consumption)
	_, err = p.ConsumeTelegramLink(ctx, token, "123456789")
	if err == nil {
		t.Fatal("expected error on reusing consumed telegram link token, got nil")
	}

	// 4. Expired token rejected
	tokExpired, err := p.CreateTelegramLink(mgmtCtx, tkt.ID)
	if err != nil {
		t.Fatalf("CreateTelegramLink for expired test failed: %v", err)
	}
	execSQL(t, ctx, p, `UPDATE telegram_link_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE ticket_id=$1::uuid AND consumed_at IS NULL`, tkt.ID)
	_, err = p.ConsumeTelegramLink(ctx, tokExpired, "987654321")
	if err == nil {
		t.Fatal("expected error on expired telegram link token, got nil")
	}
}

func TestTelegramLink_ConcurrentConsumeAtomic(t *testing.T) {
	ctx, p, _ := integration(t)
	tkt := create(t, ctx, p, parcels, "tg-concurrent-"+time.Now().Format("150405.000000"))
	mgmtCtx := WithManagementToken(WithPublicClient(ctx), "test-token")
	execSQL(t, ctx, p, `UPDATE tickets SET management_token_hash=$1 WHERE id=$2::uuid`, HashManagementToken("test-token"), tkt.ID)

	token, err := p.CreateTelegramLink(mgmtCtx, tkt.ID)
	if err != nil {
		t.Fatalf("CreateTelegramLink failed: %v", err)
	}

	// 5 concurrent attempts to consume the SAME token
	const workers = 5
	var wg sync.WaitGroup
	results := make([]error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, consumeErr := p.ConsumeTelegramLink(ctx, token, fmt.Sprintf("chat-%d", idx))
			results[idx] = consumeErr
		}(i)
	}
	wg.Wait()

	successCount := 0
	for _, res := range results {
		if res == nil {
			successCount++
		}
	}
	if successCount != 1 {
		t.Fatalf("atomic requirement violated: expected exactly 1 winner from concurrent consume, got %d", successCount)
	}
}

func TestTelegramStop_DisablesOnlyTelegram(t *testing.T) {
	ctx, p, _ := integration(t)
	tkt := create(t, ctx, p, parcels, "tg-stop-"+time.Now().Format("150405.000000"))
	mgmtCtx := WithManagementToken(WithPublicClient(ctx), "test-token")
	execSQL(t, ctx, p, `UPDATE tickets SET management_token_hash=$1 WHERE id=$2::uuid`, HashManagementToken("test-token"), tkt.ID)

	// Create TELEGRAM, WEB_PUSH and SMS subscriptions
	token, _ := p.CreateTelegramLink(mgmtCtx, tkt.ID)
	_, err := p.ConsumeTelegramLink(ctx, token, "chat-stop-test")
	if err != nil {
		t.Fatalf("consume telegram failed: %v", err)
	}
	_, err = p.UpsertNotificationSubscription(mgmtCtx, tkt.ID, domain.NotificationChannelWebPush, `{"endpoint":"https://push.example.com/sub"}`)
	if err != nil {
		t.Fatalf("upsert webpush failed: %v", err)
	}
	_, err = p.UpsertNotificationSubscription(mgmtCtx, tkt.ID, domain.NotificationChannelSMS, "+79991234567")
	if err != nil {
		t.Fatalf("upsert sms failed: %v", err)
	}

	// Send /stop for chat
	err = p.DisableTelegramForChat(ctx, "chat-stop-test")
	if err != nil {
		t.Fatalf("DisableTelegramForChat failed: %v", err)
	}

	// Check subscriptions
	subs, err := p.ListNotificationSubscriptions(mgmtCtx, tkt.ID)
	if err != nil {
		t.Fatalf("ListNotificationSubscriptions failed: %v", err)
	}

	for _, s := range subs {
		if s.Channel == domain.NotificationChannelTelegram {
			if s.Enabled {
				t.Fatal("expected TELEGRAM subscription to be disabled after /stop")
			}
		} else if s.Channel == domain.NotificationChannelWebPush || s.Channel == domain.NotificationChannelSMS {
			if !s.Enabled {
				t.Fatalf("expected channel %s to remain enabled after telegram /stop", s.Channel)
			}
		}
	}
}

func TestWebPush_SubscriptionStorageAndAccess(t *testing.T) {
	ctx, p, _ := integration(t)
	tkt := create(t, ctx, p, parcels, "webpush-"+time.Now().Format("150405.000000"))

	// Missing management token -> ErrForbidden
	_, err := p.UpsertNotificationSubscription(ctx, tkt.ID, domain.NotificationChannelWebPush, `{"endpoint":"https://push.test"}`)
	if err != application.ErrForbidden {
		t.Fatalf("expected ErrForbidden without management token, got %v", err)
	}

	mgmtCtx := WithManagementToken(WithPublicClient(ctx), "test-token")
	execSQL(t, ctx, p, `UPDATE tickets SET management_token_hash=$1 WHERE id=$2::uuid`, HashManagementToken("test-token"), tkt.ID)

	// Valid subscription creation
	destination := `{"endpoint":"https://fcm.googleapis.com/fcm/send/test","keys":{"auth":"authkey","p256dh":"p256key"}}`
	sub, err := p.UpsertNotificationSubscription(mgmtCtx, tkt.ID, domain.NotificationChannelWebPush, destination)
	if err != nil {
		t.Fatalf("UpsertNotificationSubscription failed: %v", err)
	}
	if sub.Channel != domain.NotificationChannelWebPush || sub.Destination != destination || !sub.Enabled {
		t.Fatalf("unexpected subscription state: %+v", sub)
	}

	// Disable by ID
	err = p.DisableSubscriptionByID(ctx, sub.ID)
	if err != nil {
		t.Fatalf("DisableSubscriptionByID failed: %v", err)
	}
	subs, err := p.ListNotificationSubscriptions(mgmtCtx, tkt.ID)
	if err != nil {
		t.Fatalf("ListNotificationSubscriptions failed: %v", err)
	}
	if len(subs) != 1 || subs[0].Enabled {
		t.Fatalf("expected disabled subscription after DisableSubscriptionByID, got %+v", subs)
	}
}

func TestTelegramAndWebPush_DedupeBusinessOccurrence(t *testing.T) {
	ctx, p, _ := integration(t)
	tkt := create(t, ctx, p, parcels, "dedupe-"+time.Now().Format("150405.000000"))
	mgmtCtx := WithManagementToken(WithPublicClient(ctx), "test-token")
	execSQL(t, ctx, p, `UPDATE tickets SET management_token_hash=$1 WHERE id=$2::uuid`, HashManagementToken("test-token"), tkt.ID)

	// Bind Telegram and WebPush
	token, _ := p.CreateTelegramLink(mgmtCtx, tkt.ID)
	_, _ = p.ConsumeTelegramLink(ctx, token, "chat-dedupe-1")
	_, _ = p.UpsertNotificationSubscription(mgmtCtx, tkt.ID, domain.NotificationChannelWebPush, `{"endpoint":"https://push.dedupe.test"}`)

	// Open window
	_, _ = p.ChangeWindowStatus(ctx, window1, domain.WindowStatusOpen)

	// Call next
	calledTkt, err := p.CallNext(ctx, window1)
	if err != nil {
		t.Fatalf("CallNext failed: %v", err)
	}
	if calledTkt.ID != tkt.ID {
		t.Fatalf("expected ticket %s, got %s", tkt.ID, calledTkt.ID)
	}

	// Verify exactly 1 telegram outbox item and 1 webpush outbox item created for this call
	var tgCount, pushCount int
	_ = p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND channel='TELEGRAM' AND event_type='TICKET_CALLED'`, tkt.ID).Scan(&tgCount)
	_ = p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND channel='WEB_PUSH' AND event_type='TICKET_CALLED'`, tkt.ID).Scan(&pushCount)

	if tgCount != 1 {
		t.Fatalf("expected 1 TELEGRAM notification, got %d", tgCount)
	}
	if pushCount != 1 {
		t.Fatalf("expected 1 WEB_PUSH notification, got %d", pushCount)
	}

	// Repeating enqueue for the same occurrence should not duplicate due to dedupe_key ON CONFLICT DO NOTHING
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	err = p.enqueueCallNotification(ctx, tx, calledTkt)
	if err != nil {
		t.Fatalf("repeat enqueueCallNotification failed: %v", err)
	}
	_ = tx.Commit(ctx)

	_ = p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND channel='TELEGRAM' AND event_type='TICKET_CALLED'`, tkt.ID).Scan(&tgCount)
	_ = p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND channel='WEB_PUSH' AND event_type='TICKET_CALLED'`, tkt.ID).Scan(&pushCount)
	if tgCount != 1 {
		t.Fatalf("expected STILL 1 TELEGRAM notification after repeat enqueue, got %d", tgCount)
	}
	if pushCount != 1 {
		t.Fatalf("expected STILL 1 WEB_PUSH notification after repeat enqueue, got %d", pushCount)
	}
}
