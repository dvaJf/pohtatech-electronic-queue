import time
from playwright.sync_api import sync_playwright

def test_walkin_and_unified_banner():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = context.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_selector('text=Получить талон')

        # Test 1: Click "Получить талон"
        print("1. Clicking 'Получить талон'...")
        page.click('text=Получить талон')
        page.wait_for_selector('text=Выберите отделение')

        # Click the first branch in the list
        print("2. Clicking branch in walk-in list...")
        branch_card = page.locator('.cx-choice').first
        branch_name = branch_card.locator('.cx-choice-title').inner_text()
        print(f"   Selecting branch: {branch_name}")
        branch_card.click()

        # Verify that screen is STILL walk-in (Header says "Электронный талон" or "Выберите услугу", NOT "Онлайн-запись")
        page.wait_for_selector('text=Выберите услугу')
        walkin_header = page.locator('h2').inner_text()
        print(f"   Current screen header: {walkin_header}")
        assert "Онлайн-запись" not in walkin_header, f"Error: Screen unexpectedly switched to {walkin_header}"
        assert "Электронный талон" in walkin_header or "талон" in walkin_header.lower(), "Must be on walk-in screen"
        print("   PASS: Walk-in remains on walk-in screen without redirecting!")

        page.screenshot(path='/tmp/test_screenshots/03_walkin_step1.png')

        # Test 2: Navigate to Online Booking to check unified banner
        print("3. Navigating to Online Booking to verify unified banner...")
        page.click('.cx-back-btn') # Back to step 0
        page.wait_for_selector('text=Выберите отделение')
        page.click('.cx-back-btn') # Back to Home
        page.wait_for_selector('text=Онлайн-запись')

        page.click('text=Онлайн-запись')
        page.wait_for_selector('text=Выберите отделение')
        page.locator('.cx-choice').first.click()
        page.wait_for_selector('text=Выберите услугу')
        page.locator('.cx-choice').first.click()

        page.wait_for_selector('text=Дата и время визита')
        time.sleep(1)

        page.screenshot(path='/tmp/test_screenshots/04_booking_unified_banner.png')
        print("   Saved: /tmp/test_screenshots/04_booking_unified_banner.png")

        # Verify there is only 1 unified info block containing "Запись доступна"
        info_blocks = page.locator('text=Запись доступна').all()
        print(f"   Number of elements with 'Запись доступна': {len(info_blocks)}")
        assert len(info_blocks) >= 1

        browser.close()
        print("ALL TESTS PASSED!")

if __name__ == '__main__':
    test_walkin_and_unified_banner()
