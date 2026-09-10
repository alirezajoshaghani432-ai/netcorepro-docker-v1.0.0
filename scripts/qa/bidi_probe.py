#!/usr/bin/env python3
"""Character-level bidi probe.

Measures the on-screen x position of every glyph in the mega-menu labels to
show where the Unicode Bidi Algorithm actually places a trailing "(count)"
inside a mixed Persian+Latin string. Diagnostic helper, not a test.
"""
import asyncio
from playwright.async_api import async_playwright
BASE = "http://127.0.0.1:8090"

JS = """el => {
  const chars = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let n;
  while (n = w.nextNode()) {
    for (let i = 0; i < n.textContent.length; i++) {
      const ch = n.textContent[i];
      if (!ch.trim()) continue;
      r.setStart(n, i); r.setEnd(n, i + 1);
      const b = r.getBoundingClientRect();
      chars.push({ ch, x: b.left });
    }
  }
  // sort by visual position, right-to-left = the order a Persian reader scans
  chars.sort((a, b) => b.x - a.x);
  return chars.map(c => c.ch).join('');
}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1440, "height": 950})
        await pg.goto(f"{BASE}/", wait_until="networkidle")
        await pg.locator("#nc-cats-btn").hover()
        await pg.wait_for_timeout(600)
        menu = pg.locator("#nc-cats-menu")
        for slug in ["cable-cat6-utp", "cable-outdoor-sftp", "modem-4g-lte",
                     "switch-5-port", "adapter-12v"]:
            a = menu.locator(f'a[href*="{slug}"]').first
            if not await a.count():
                continue
            src = (await a.inner_text()).replace("\n", " ")
            vis = await a.evaluate(JS)
            print(f"{slug:22} source={src!r}")
            print(f"{'':22} reader-scan(R->L)={vis!r}")
        await b.close()

asyncio.run(main())
