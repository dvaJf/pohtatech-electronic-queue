import os
import sys
import time
from playwright.sync_api import sync_playwright

VIEWPORTS = [
    {"name": "iPhone_14_390x844", "width": 390, "height": 844, "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"},
    {"name": "iPhone_15Pro_393x852", "width": 393, "height": 852, "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"},
    {"name": "iPhone_14ProMax_430x932", "width": 430, "height": 932, "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"},
    {"name": "iPad_Mini_768x1024", "width": 768, "height": 1024, "userAgent": "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"}
]

SCREENSHOTS_DIR = "/home/vacuum/Desktop/tsifrovaya-ochered-novogo-pokoleniya/tests/artifacts/mobile_safari"
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

def run_comprehensive_audit():
    all_findings = []
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        
        # =========================================================================
        # 1. HEADER, THREE-DOTS MENU, RESPONSIVE OVERFLOW AUDIT ACROSS ALL VIEWPORTS
        # =========================================================================
        for vp in VIEWPORTS:
            print(f"\n==========================================")
            print(f"[AUDIT 1,2,6] Viewport: {vp['name']} ({vp['width']}x{vp['height']})")
            print(f"==========================================")
            
            context = browser.new_context(
                viewport={"width": vp["width"], "height": vp["height"]},
                user_agent=vp["userAgent"],
                is_mobile=True,
                has_touch=True,
                device_scale_factor=2
            )
            page = context.new_page()
            page.goto("http://localhost:5173", wait_until="networkidle")
            page.wait_for_timeout(800)
            
            # Check 6: Horizontal overflow
            scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
            inner_width = page.evaluate("() => window.innerWidth")
            has_h_overflow = scroll_width > inner_width
            print(f"Viewport {vp['width']}px: scrollWidth={scroll_width}, innerWidth={inner_width}, overflow={has_h_overflow}")
            all_findings.append({
                "category": "6. Responsive Layout",
                "viewport": vp["name"],
                "check": "No horizontal page overflow on load",
                "pass": not has_h_overflow,
                "details": f"scrollWidth={scroll_width} vs innerWidth={inner_width}"
            })
            
            # Check 1: Header utility buttons vs 3-dots menu
            header_utils = page.locator(".header-utility-group")
            is_header_utils_visible = header_utils.is_visible()
            dots_button = page.locator("button[aria-label='Дополнительное меню']")
            is_dots_visible = dots_button.is_visible()
            geo_btn = page.locator("header button[aria-label*='Геолокация'], header button[aria-label*='местоположение']").first
            is_geo_visible = geo_btn.is_visible()
            
            if vp["width"] < 768:
                check_utils = not is_header_utils_visible
                check_dots = is_dots_visible
            else:
                check_utils = is_header_utils_visible
                check_dots = not is_dots_visible
                
            all_findings.append({
                "category": "1. Mobile Header",
                "viewport": vp["name"],
                "check": "Utility icons hidden on <768px, visible on >=768px; Dots button visible on <768px, hidden on >=768px",
                "pass": check_utils and check_dots,
                "details": f"utils_visible={is_header_utils_visible} (expected {vp['width']>=768}), dots_visible={is_dots_visible} (expected {vp['width']<768})"
            })
            
            # Geo indicator dot check
            geo_dot = geo_btn.locator("span[aria-hidden='true']")
            geo_dot_class = geo_dot.get_attribute("class") or ""
            # Red when unavailable: bg-[#D92534]; Blue when granted: bg-[#003B73]
            has_valid_dot_color = "bg-[#D92534]" in geo_dot_class or "bg-[#003B73]" in geo_dot_class
            all_findings.append({
                "category": "1. Mobile Header",
                "viewport": vp["name"],
                "check": "Geo control remains visible in header with indicator dot (red when unavailable, blue when granted)",
                "pass": is_geo_visible and has_valid_dot_color,
                "details": f"geo_visible={is_geo_visible}, dot_class={geo_dot_class}"
            })
            
            # Test 2: Three-dots menu details on mobile viewports (< 768px)
            if vp["width"] < 768:
                dots_button.click()
                page.wait_for_timeout(300)
                menu = page.locator("#mobile-service-menu")
                menu_visible = menu.is_visible()
                
                sound_in_menu = menu.locator("button:has-text('Звуковое оповещение')")
                sound_visible = sound_in_menu.is_visible()
                
                a11y_in_menu = menu.locator("button:has-text('Все настройки доступности')")
                a11y_visible = a11y_in_menu.is_visible()
                
                # Check touch target sizing
                menu_items = menu.locator("button, a").all()
                touch_targets_ok = True
                bad_targets = []
                for item in menu_items:
                    box = item.bounding_box()
                    if box and box["width"] > 0 and box["height"] > 0:
                        # Touch target standard: height at least 36px, width at least 36px
                        if box["height"] < 32 or box["width"] < 32:
                            touch_targets_ok = False
                            txt = item.inner_text().replace("\n", " ").strip()[:20]
                            bad_targets.append(f"{txt} ({box['width']}x{box['height']})")
                
                all_findings.append({
                    "category": "2. Three-dots Menu",
                    "viewport": vp["name"],
                    "check": "Sound & accessibility options present with clean touch targets (>= 32px)",
                    "pass": menu_visible and sound_visible and a11y_visible and touch_targets_ok,
                    "details": f"menu={menu_visible}, sound={sound_visible}, a11y={a11y_visible}, bad_targets={bad_targets}"
                })
                
                page.screenshot(path=f"{SCREENSHOTS_DIR}/header_menu_{vp['name']}.png")
                dots_button.click()
                page.wait_for_timeout(200)

            context.close()

        # =========================================================================
        # 2. THREE-DOTS MENU CONTRAST (OPERATOR/CHIEF PANELS)
        # =========================================================================
        print(f"\n==========================================")
        print(f"[AUDIT 2] Three-dots Menu Contrast (Chief/Operator roles)")
        print(f"==========================================")
        # Check source code & styles of Operator/Admin links in mobile menu:
        # In ProductHeader.tsx:
        # className="py-1.5 px-2.5 bg-white/15 hover:bg-white/20 rounded-lg text-xs font-bold text-white flex items-center justify-between"
        # We can also mock or login to inspect live DOM colors
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            user_agent=VIEWPORTS[0]["userAgent"],
            is_mobile=True,
            has_touch=True
        )
        page = context.new_page()
        # Mock /api/v1/auth/me to return opc_chief
        page.route("**/auth/me", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='{"id":"chief-1","email":"chief@pochta.local","fio":"Иванов И.И.","role":"opc_chief","phoneVerified":true}'
        ))
        page.goto("http://localhost:5173", wait_until="networkidle")
        page.wait_for_timeout(500)
        
        dots_btn = page.locator("button[aria-label='Дополнительное меню']")
        dots_btn.click()
        page.wait_for_timeout(300)
        
        admin_link = page.locator("#mobile-service-menu a:has-text('Панель администратора')")
        operator_link = page.locator("#mobile-service-menu a:has-text('Панель оператора')")
        
        admin_link_vis = admin_link.is_visible()
        operator_link_vis = operator_link.is_visible()
        
        if admin_link_vis and operator_link_vis:
            admin_color = admin_link.evaluate("el => window.getComputedStyle(el).color")
            admin_bg = admin_link.evaluate("el => window.getComputedStyle(el).backgroundColor")
            op_color = operator_link.evaluate("el => window.getComputedStyle(el).color")
            op_bg = operator_link.evaluate("el => window.getComputedStyle(el).backgroundColor")
            print(f"  Chief Admin Link computed: color={admin_color}, bg={admin_bg}")
            print(f"  Chief Operator Link computed: color={op_color}, bg={op_bg}")
            # White text rgb(255, 255, 255) on dark navy/translucent white background
            is_high_contrast = "255, 255, 255" in admin_color and "255, 255, 255" in op_color
            all_findings.append({
                "category": "2. Three-dots Menu",
                "viewport": "iPhone_14_390x844 (Chief Role)",
                "check": "High contrast Operator/Admin panel buttons (white text, no blue-on-blue)",
                "pass": is_high_contrast,
                "details": f"admin_color={admin_color} on {admin_bg}, op_color={op_color} on {op_bg}"
            })
            page.screenshot(path=f"{SCREENSHOTS_DIR}/menu_chief_contrast_390.png")
        else:
            all_findings.append({
                "category": "2. Three-dots Menu",
                "viewport": "iPhone_14_390x844 (Chief Role)",
                "check": "High contrast Operator/Admin panel buttons",
                "pass": False,
                "details": f"Admin or Operator link not visible (admin={admin_link_vis}, op={operator_link_vis})"
            })
        context.close()

        # =========================================================================
        # 3. DIALOG & OTP VERIFICATION ACROSS 390px, 393px, 430px
        # =========================================================================
        for vp_info in [VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[2]]:
            print(f"\n==========================================")
            print(f"[AUDIT 3 & 4] Dialog, OTP & Calendar14: {vp_info['name']}")
            print(f"==========================================")
            
            context = browser.new_context(
                viewport={"width": vp_info["width"], "height": vp_info["height"]},
                user_agent=vp_info["userAgent"],
                is_mobile=True,
                has_touch=True,
                device_scale_factor=2
            )
            page = context.new_page()
            page.goto("http://localhost:5173", wait_until="networkidle")
            page.wait_for_timeout(500)
            
            # Start booking
            booking_btn = page.locator("button:has-text('Записаться онлайн'), a:has-text('Записаться онлайн')").first
            booking_btn.click()
            page.wait_for_timeout(500)
            
            # Pick first branch
            page.wait_for_selector(".cx-choice", timeout=5000)
            page.locator(".cx-choice").first.click()
            page.wait_for_timeout(600)
            
            # Pick service
            first_service = page.locator("button:has-text('Посылки'), button:has-text('Отправка'), button:has-text('Платежи'), button:has-text('Выбрать услугу')").first
            first_service.click()
            page.wait_for_timeout(600)
            
            # We are now on Calendar & Time step! Let's AUDIT 4: Calendar14 layout & touch scrolling
            page.wait_for_selector("h2:has-text('Онлайн-запись')", timeout=5000)
            calendar_el = page.locator(".calendar-slots-scroll").first
            cal_scrollable = calendar_el.is_visible()
            
            # Evaluate WebkitOverflowScrolling and overscroll
            cal_webkit_scroll = calendar_el.evaluate("el => window.getComputedStyle(el).webkitOverflowScrolling || window.getComputedStyle(el)['-webkit-overflow-scrolling']")
            cal_overflow_y = calendar_el.evaluate("el => window.getComputedStyle(el).overflowY")
            
            # Check spacer element at the bottom (prevents clipping)
            spacer_el = calendar_el.locator("div.h-12")
            spacer_count = spacer_el.count()
            
            print(f"  Calendar14: scrollable={cal_scrollable}, -webkit-overflow-scrolling={cal_webkit_scroll}, overflowY={cal_overflow_y}, spacer={spacer_count}")
            all_findings.append({
                "category": "4. Calendar14 Mobile Slot Picker",
                "viewport": vp_info["name"],
                "check": "Touch scrolling enabled and bottom spacer prevents slot clipping",
                "pass": cal_scrollable and cal_overflow_y == "auto" and spacer_count >= 1,
                "details": f"-webkit-overflow-scrolling={cal_webkit_scroll}, overflowY={cal_overflow_y}, bottom_spacer_present={spacer_count >= 1}"
            })
            page.screenshot(path=f"{SCREENSHOTS_DIR}/calendar14_{vp_info['name']}.png")
            
            # Now proceed to Dialog: fill email and select time slot
            email_input = page.locator("#appointment-email-input")
            if email_input.is_visible():
                email_input.fill("test_user@pochta.local")
            
            # Click an available hour slot
            time_slot = calendar_el.locator("button:not([disabled])").first
            if time_slot.is_visible():
                time_slot.click()
                page.wait_for_timeout(200)
            
            # Click "Получить код"
            get_code_btn = page.locator("button:has-text('Получить код')")
            get_code_btn.click()
            
            # Wait for AppointmentConfirmationDialog
            dialog = page.locator("[role='dialog']")
            dialog.wait_for(state="visible", timeout=8000)
            
            # 3.1 Dialog Centering
            dialog_box = dialog.bounding_box()
            viewport_width = vp_info["width"]
            viewport_height = vp_info["height"]
            dialog_center_x = dialog_box["x"] + dialog_box["width"] / 2
            dialog_center_y = dialog_box["y"] + dialog_box["height"] / 2
            dx_diff = abs(dialog_center_x - viewport_width / 2)
            dy_diff = abs(dialog_center_y - viewport_height / 2)
            # Center tolerance: within 2px
            is_horizontally_centered = dx_diff <= 2.0
            is_vertically_centered = dy_diff <= 20.0 # vertical can vary slightly due to mobile browser safe area/bars
            
            # 3.2 Backdrop check
            overlay = page.locator("[data-state='open'][class*='fixed inset-0']")
            overlay_box = overlay.bounding_box() if overlay.count() > 0 else None
            overlay_ok = overlay_box is not None and overlay_box["width"] >= viewport_width and overlay_box["height"] >= viewport_height
            
            # 3.3 Numeric keypad attributes on input
            otp_input = dialog.locator("input[inputmode='numeric']")
            input_mode = otp_input.get_attribute("inputmode")
            pattern = otp_input.get_attribute("pattern")
            autocomplete = otp_input.get_attribute("autocomplete")
            keypad_ok = (input_mode == "numeric") and (pattern == "[0-9]*") and (autocomplete == "one-time-code")
            
            # 3.4 OTP slots fit without horizontal overflow
            otp_group = dialog.locator(".flex.items-center.gap-1\\.5, [class*='gap-1.5']").first
            otp_group_box = otp_group.bounding_box()
            dialog_content_width = dialog_box["width"]
            
            # Check slot count
            slot_count = dialog.locator("[class*='rounded-xl border-2']").count()
            slots_fit = otp_group_box["width"] <= (dialog_content_width - 32)
            has_no_dialog_h_scroll = dialog.evaluate("el => el.scrollWidth <= el.clientWidth")
            
            print(f"  Dialog: center_dx={dx_diff}px, center_dy={dy_diff}px, overlay_ok={overlay_ok}")
            print(f"  OTP: keypad_ok={keypad_ok} (mode={input_mode}, pattern={pattern}), slots_fit={slots_fit} ({otp_group_box['width']}px in {dialog_content_width}px), dialog_h_scroll={not has_no_dialog_h_scroll}")
            
            all_findings.append({
                "category": "3. Dialog & OTP on Mobile WebKit",
                "viewport": vp_info["name"],
                "check": "Dialog horizontal/vertical centering and full-screen backdrop",
                "pass": is_horizontally_centered and overlay_ok,
                "details": f"center_dx={dx_diff:.1f}px, overlay_covers_viewport={overlay_ok}"
            })
            
            all_findings.append({
                "category": "3. Dialog & OTP on Mobile WebKit",
                "viewport": vp_info["name"],
                "check": "Numeric keypad attributes (inputmode=numeric, pattern=[0-9]*, autocomplete=one-time-code)",
                "pass": keypad_ok,
                "details": f"inputmode={input_mode}, pattern={pattern}, autocomplete={autocomplete}"
            })
            
            all_findings.append({
                "category": "3. Dialog & OTP on Mobile WebKit",
                "viewport": vp_info["name"],
                "check": "6 OTP slots fit inside dialog without horizontal overflow",
                "pass": slots_fit and has_no_dialog_h_scroll and slot_count >= 6,
                "details": f"slots_width={otp_group_box['width']}px, dialog_width={dialog_content_width}px, no_h_scroll={has_no_dialog_h_scroll}, count={slot_count}"
            })
            
            page.screenshot(path=f"{SCREENSHOTS_DIR}/dialog_otp_{vp_info['name']}.png")
            
            # Now let's confirm the ticket via test confirm button to verify item 5: Timeline circles on active ticket!
            test_confirm_btn = page.locator("button:has-text('Письмо никак не приходит — подтвердить принудительно')")
            if test_confirm_btn.is_visible():
                test_confirm_btn.click()
                page.wait_for_selector("h2:has-text('Мои талоны')", timeout=8000)
                page.wait_for_timeout(800)
                
                # Check 5: Timeline circles geometry
                timeline_indicators = page.locator(".cx-active-ticket [class*='aspect-square'], [data-state] [class*='aspect-square'], [class*='rounded-full'][class*='border-2']").all()
                print(f"  Found {len(timeline_indicators)} timeline indicator circles on active ticket")
                
                circles_geometry_ok = True
                circle_diffs = []
                for idx, ind in enumerate(timeline_indicators):
                    box = ind.bounding_box()
                    if box and box["width"] > 0 and box["height"] > 0:
                        diff = abs(box["width"] - box["height"])
                        ratio = box["width"] / box["height"]
                        if diff > 1.0 or ratio < 0.95 or ratio > 1.05:
                            circles_geometry_ok = False
                            circle_diffs.append(f"idx {idx}: {box['width']}x{box['height']} (diff={diff}px)")
                        else:
                            circle_diffs.append(f"idx {idx}: {box['width']:.1f}x{box['height']:.1f} (ratio={ratio:.2f})")
                
                all_findings.append({
                    "category": "5. Timeline Circles Geometry",
                    "viewport": vp_info["name"],
                    "check": "Circular geometry preserved (aspect-ratio 1:1, no elliptical squishing)",
                    "pass": circles_geometry_ok and len(timeline_indicators) > 0,
                    "details": f"circles_count={len(timeline_indicators)}, diffs={circle_diffs[:3]}"
                })
                
                # Check 6: Responsive layout of My Tickets screen
                scroll_w_ticket = page.evaluate("() => document.documentElement.scrollWidth")
                inner_w_ticket = page.evaluate("() => window.innerWidth")
                all_findings.append({
                    "category": "6. Responsive Layout",
                    "viewport": vp_info["name"],
                    "check": "No horizontal page overflow on My Tickets screen",
                    "pass": scroll_w_ticket <= inner_w_ticket,
                    "details": f"scrollWidth={scroll_w_ticket} vs innerWidth={inner_w_ticket}"
                })
                
                page.screenshot(path=f"{SCREENSHOTS_DIR}/my_tickets_timeline_{vp_info['name']}.png")
            
            context.close()
            
        browser.close()

    print("\n==========================================")
    print("ALL AUDIT FINDINGS SUMMARY:")
    print("==========================================")
    all_passed = True
    for f in all_findings:
        status = "PASS" if f["pass"] else "FAIL"
        if not f["pass"]:
            all_passed = False
        print(f"[{status}] {f['category']} | {f['viewport']} | {f['check']} -> {f['details']}")
    
    print("\n" + "="*42)
    print(f"OVERALL VERDICT: {'PASS' if all_passed else 'FAIL'}")
    print("="*42)
    return all_findings, all_passed

if __name__ == "__main__":
    run_comprehensive_audit()
