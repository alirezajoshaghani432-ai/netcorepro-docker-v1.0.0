#!/usr/bin/env python3
"""Reproduce the four owner-reported mega-menu defects (round 5, 2026-08-05)."""
import asyncio, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8090"


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        await pg.goto(f"{BASE}/", wait_until="networkidle")

        btn = pg.locator("#nc-cats-btn")
        menu = pg.locator("#nc-cats-menu")

        # ---------- D1: hover gap ----------
        await btn.hover()
        await pg.wait_for_timeout(350)
        print("D1 menu visible after hovering button :", await menu.is_visible())
        bb, mb = await btn.bounding_box(), await menu.bounding_box()
        print(f"    button bottom={bb['y']+bb['height']:.0f}  menu top={mb['y']:.0f}"
              f"  GAP={mb['y']-(bb['y']+bb['height']):.1f}px")
        # walk the mouse down through the gap, as the owner did in the video
        cx = bb["x"] + bb["width"] / 2
        for y in range(int(bb["y"] + bb["height"] / 2), int(mb["y"]) + 30, 3):
            await pg.mouse.move(cx, y)
        await pg.wait_for_timeout(250)
        print("D1 menu still visible inside panel:", await menu.is_visible(), "<-- must be True")

        # ---------- D2: click a sub-category ----------
        await btn.hover()
        await pg.wait_for_timeout(300)
        link = menu.locator('a[href*="cable-cat6-utp"]').first
        if await link.count():
            await link.hover()
            await link.click()
            await pg.wait_for_timeout(1200)
            print("D2 url after click            :", pg.url)
            print("D2 menu still covering page   :", await menu.is_visible(), "<-- must be False")
        else:
            print("D2 SKIP: link not reachable (menu closed) — that itself is defect D1")

        # ---------- D3: bidi of counts ----------
        await pg.goto(f"{BASE}/", wait_until="networkidle")
        await btn.hover()
        await pg.wait_for_timeout(350)
        for sel in ["cable-cat6-utp", "cable-outdoor-sftp", "modem-4g-lte"]:
            a = menu.locator(f'a[href*="{sel}"]').first
            if not await a.count():
                continue
            box = await a.bounding_box()
            # x-position of every text fragment, to see where the count lands
            frags = await a.evaluate("""el => {
              const out=[]; const w=document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
              let n; const r=document.createRange();
              while(n=w.nextNode()){ const t=n.textContent.trim(); if(!t) continue;
                r.selectNodeContents(n); const b=r.getBoundingClientRect();
                out.push({t:t, left:Math.round(b.left), right:Math.round(b.right)}); }
              return out; }""")
            frags.sort(key=lambda f: -f["right"])
            print(f"D3 {sel}: visual RTL order ->", " | ".join(f["t"] for f in frags))

        # ---------- D4: brand logo colour ----------
        blogo = menu.locator(".nc-megaboard-brands a").first
        if await blogo.count():
            st = await blogo.evaluate("el => { const s=getComputedStyle(el);"
                                      "return {filter:s.filter, opacity:s.opacity}; }")
            print("D4 brand strip style          :", st, "<-- must be filter:none, opacity:1")

        await b.close()


asyncio.run(main())
