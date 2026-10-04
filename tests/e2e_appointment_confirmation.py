import os
import sys
import time
from playwright.sync_api import sync_playwright

def run_test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        print("1. Navigating to http://localhost:5173 ...")
        page.goto("http://localhost:5173", wait_until="networkidle")
        time.sleep(1)

        print("2. Starting online booking...")
        booking_btn = page.locator("button:has-text('Записаться онлайн'), a:has-text('Записаться онлайн')").first
        booking_btn.click()
        page.wait_for_timeout(500)

        # Select first available branch
        print("3. Selecting branch...")
        page.wait_for_selector(".cx-choice", timeout=5000)
        first_branch = page.locator(".cx-choice").first
        first_branch.click()
        page.wait_for_timeout(800)

        # Select service
        print("4. Selecting service...")
        first_service = page.locator("button:has-text('Выбрать услугу'), .cx-service-card, button:has-text('Отправка'), button:has-text('Письма')").first
        if not first_service.is_visible():
            first_service = page.locator(".cx-wizard button, .grid button").first
        first_service.click()
        page.wait_for_timeout(800)

        # Step 3: Date and Time
        print("5. Date and Time step reached. Selecting time and entering email...")
        page.wait_for_selector("h2:has-text('Онлайн-запись')", timeout=5000)
        assert page.locator("h2:has-text('Онлайн-запись')").is_visible()

        # Fill email
        email_input = page.locator("#appointment-email-input")
        if email_input.is_visible():
            email_input.fill("user_test@pochta.local")
        
        # Select time slot if needed
        time_slot = page.locator("button:has-text(':')").first
        if time_slot.is_visible():
            time_slot.click()
            page.wait_for_timeout(300)

        # Click "Получить код"
        print("6. Clicking 'Получить код'...")
        get_code_btn = page.locator("button:has-text('Получить код')")
        get_code_btn.click()

        # Wait for Dialog to appear
        print("7. Waiting for AppointmentConfirmationDialog...")
        dialog = page.locator("[role='dialog']")
        dialog.wait_for(state="visible", timeout=10000)

        # Assert:
        # 1. Underlay booking screen still exists and is rendered
        assert page.locator("h2:has-text('Онлайн-запись')").is_visible(), "Booking screen must remain active underneath dialog"
        # 2. Dialog is visible
        assert dialog.is_visible(), "Dialog must be visible"
        # 3. My tickets is NOT active
        assert not page.locator("h2:has-text('Мои талоны')").is_visible(), "My tickets must NOT be active while dialog is open"

        print("8. Saving screenshot of Dialog over Booking Screen...")
        os.makedirs("/tmp/test_screenshots", exist_ok=True)
        screenshot_dialog = "/tmp/test_screenshots/01_booking_dialog_modal.png"
        page.screenshot(path=screenshot_dialog)
        print(f"   Saved: {screenshot_dialog}")

        # Check Dialog elements
        assert page.locator("text=Подтвердите запись").is_visible(), "Dialog title must be present"
        assert page.locator("text=u***l@pochta.local").is_visible() or page.locator("text=@pochta.local").is_visible(), "Masked email must be present"
        assert page.locator("text=Осталось").is_visible(), "Countdown must be present"
        assert page.locator("text=Не получили письмо?").is_visible(), "Spam hint must be present"
        assert page.locator("button:has-text('Отправить')").is_visible(), "Resend action must be present"

        # Check "Письмо никак не приходит — подтвердить принудительно"
        force_confirm_btn = page.locator("button:has-text('Письмо никак не приходит — подтвердить принудительно')")
        assert force_confirm_btn.is_visible(), "Force confirm button must be visible"

        print("9. Clicking 'Письмо никак не приходит — подтвердить принудительно'...")
        force_confirm_btn.click()

        print("10. Waiting for success and transition to My Tickets...")
        page.wait_for_selector("h2:has-text('Мои талоны')", timeout=10000)
        page.wait_for_timeout(500)

        # Assert: Dialog is closed
        assert not dialog.is_visible(), "Dialog must be closed after success"
        # Assert: My tickets is active
        assert page.locator("h2:has-text('Мои талоны')").is_visible(), "My tickets must be active after confirmation"

        screenshot_my = "/tmp/test_screenshots/02_my_tickets_confirmed.png"
        page.screenshot(path=screenshot_my)
        print(f"   Saved: {screenshot_my}")
        print("ALL PLAYWRIGHT ASSERTIONS PASSED!")

        browser.close()

if __name__ == "__main__":
    run_test()
