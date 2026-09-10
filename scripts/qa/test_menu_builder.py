"""End-to-end UI test for /admin/menu-builder.

Drives the panel through a real browser session:
  1. log in through the admin form
  2. click a category name, type a new one, press Enter
  3. reload and confirm the rename persisted
  4. click the eye icon and confirm the storefront menu drops the category
  5. click it again and confirm the storefront menu shows it
  6. restore the original name

Set SCREENSHOT_PATH to also save a full-page screenshot of the panel.
"""
import os
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8090"
EMAIL = "admin@netcorepro.ir"
PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


def storefront_menu_html():
    """Return only the mega-menu block of the homepage."""
    html = urllib.request.urlopen(BASE + "/").read().decode()
    m = re.search(r'id="nc-cats-menu".*?</nav>', html, re.S)
    return m.group(0) if m else ""


def main():
    ok = True
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        pg = b.new_page(viewport={"width": 1440, "height": 950})

        # ---- 1. login ----
        pg.goto(BASE + "/admin", wait_until="networkidle")
        pg.fill('input[name="email"], input[type="email"]', EMAIL)
        pg.fill('input[name="password"], input[type="password"]', PASSWORD)
        pg.click('button[type="submit"]')
        pg.wait_for_timeout(2500)
        print("after login url:", pg.url)

        # ---- 2. open the menu builder ----
        pg.goto(BASE + "/admin/menu-builder", wait_until="networkidle")
        pg.wait_for_selector(".mb-card", timeout=15000)
        cards = pg.locator(".mb-card").count()
        print("columns rendered:", cards)
        ok &= cards > 0

        title = pg.locator(".mb-title").first
        original = title.inner_text().strip()
        print("target column:", original)

        # ---- 3. rename in place ----
        new_name = original + " تست"
        title.click()
        pg.wait_for_timeout(250)
        pg.keyboard.press("Control+A")
        pg.keyboard.type(new_name)
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(1500)

        pg.reload(wait_until="networkidle")
        pg.wait_for_selector(".mb-card", timeout=15000)
        after = pg.locator(".mb-title").first.inner_text().strip()
        renamed = after == new_name
        print("rename persisted:", renamed, "->", after)
        ok &= renamed

        # ---- 4. hide via the eye icon ----
        pg.locator(".mb-card").first.locator(".mb-head .mb-toggle").click()
        pg.wait_for_timeout(1500)
        hidden_cls = "mb-hidden" in (pg.locator(".mb-card").first.get_attribute("class") or "")
        in_menu = new_name in storefront_menu_html()
        print("card marked hidden:", hidden_cls, "| still in storefront menu:", in_menu)
        ok &= hidden_cls and not in_menu

        # ---- 5. show again ----
        pg.locator(".mb-card").first.locator(".mb-head .mb-toggle").click()
        pg.wait_for_timeout(1500)
        back = new_name in storefront_menu_html()
        print("back in storefront menu:", back)
        ok &= back

        # ---- 6. restore original name ----
        t2 = pg.locator(".mb-title").first
        t2.click()
        pg.wait_for_timeout(250)
        pg.keyboard.press("Control+A")
        pg.keyboard.type(original)
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(1500)
        restored = pg.locator(".mb-title").first.inner_text().strip() == original
        print("name restored:", restored)
        ok &= restored

        shot = os.environ.get("SCREENSHOT_PATH")
        if shot:
            pg.screenshot(path=shot, full_page=True)
        b.close()

    print("\nRESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
