"""
Diagnostic script — opens the dashboard, waits, then prints:
- All frame URLs
- Whether the slicer is found in each frame
- A screenshot saved to scraper/debug_screenshot.png

Run from the Backend folder:
    python -m scraper.debug_dashboard
"""

import asyncio
from playwright.async_api import async_playwright

DASHBOARD_URL = (
    "https://www.beer-sheva.muni.il/City/OnTheCity/b7numbers/Documents/demographic-dash.html"
)


async def scan_frame(frame, depth=0):
    indent = "  " * depth
    print(f"{indent}Frame: {frame.url[:120]}")
    try:
        containers = frame.locator(".slicerContainer")
        n = await containers.count()
        print(f"{indent}  Total slicerContainers: {n}")
        if n == 0:
            return

        # The dropdown toggle buttons — clicking these opens the slicer dropdown
        triggers = frame.locator("[aria-haspopup='listbox']")
        trigger_count = await triggers.count()
        print(f"{indent}  Dropdown triggers [aria-haspopup=listbox]: {trigger_count}")

        for i in range(trigger_count):
            trigger = triggers.nth(i)
            label = await trigger.get_attribute("aria-label")
            print(f"\n  --- Trigger[{i}] aria-label='{label}' ---")

            # Click the trigger to open the dropdown
            try:
                await trigger.click(timeout=5000)
                await frame.wait_for_timeout(2000)
            except Exception as e:
                print(f"  Click failed: {e}")
                continue

            # After opening, find items inside the now-visible dropdown
            items = frame.locator(".slicerItemContainer")
            item_count = await items.count()
            aria_setsize = None
            if item_count > 0:
                aria_setsize = await items.first.get_attribute("aria-setsize")
            titles = []
            for j in range(min(5, item_count)):
                t = await items.nth(j).get_attribute("title")
                titles.append(t)
            print(f"  After open: visible_items={item_count}, aria-setsize={aria_setsize}")
            print(f"  First titles: {titles}")

            # Close it again before moving to the next
            try:
                await trigger.click(timeout=3000)
                await frame.wait_for_timeout(500)
            except Exception:
                pass

    except Exception as e:
        print(f"{indent}  Error scanning frame: {e}")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()

        print(f"Loading: {DASHBOARD_URL}")
        await page.goto(DASHBOARD_URL, wait_until="networkidle", timeout=60000)
        print("networkidle reached, waiting 8 more seconds for Power BI...")
        await page.wait_for_timeout(8000)

        await page.screenshot(path="scraper/debug_screenshot.png", full_page=True)
        print("Screenshot saved to scraper/debug_screenshot.png\n")

        print("=== All frames ===")
        await scan_frame(page, depth=0)
        for frame in page.frames:
            if frame != page.main_frame:
                await scan_frame(frame, depth=1)

        print("\nKeeping browser open for 15 seconds so you can inspect it manually...")
        await page.wait_for_timeout(15000)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
