#!/usr/bin/env python3
import asyncio, sys
from playwright.async_api import async_playwright
BASE = "http://127.0.0.1:8090"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/root/webapp/ncp_v2/menu_before.png"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1440, "height": 950})
        await pg.goto(f"{BASE}/", wait_until="networkidle")
        await pg.locator("#nc-cats-btn").hover()
        await pg.wait_for_timeout(700)
        m = pg.locator("#nc-cats-menu")
        await m.screenshot(path=OUT)
        print("saved", OUT)
        await b.close()

asyncio.run(main())
