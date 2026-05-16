"""
Scrapes total street population from the Beer Sheva demographic dashboard
and updates each shelter in the ShelterTest collection with demographicPotential.

Usage (from the Backend folder):
    python -m scraper.demographic_scraper

First-time setup:
    pip install playwright
    playwright install chromium
"""

import asyncio
import re
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from playwright.async_api import async_playwright, Page, Frame
from dotenv import load_dotenv
import os
import certifi

load_dotenv()

DASHBOARD_URL = (
    "https://www.beer-sheva.muni.il/City/OnTheCity/b7numbers/Documents/demographic-dash.html"
)
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "tosafe_place")
COLLECTION = "ShelterTest"

# The StreetName slicer dropdown trigger (aria-label confirmed from debug)
STREET_TRIGGER = '[aria-haspopup="listbox"][aria-label="StreetName"]'

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


def extract_street_name(address: str) -> str:
    """
    'חנה סנש 5'  →  'חנה סנש'
    Strips the trailing house number (digits + optional Hebrew letter).
    """
    return re.sub(r"\s+\d+[א-ת]?$", "", address.strip()).strip()


async def get_pbi_frame(page: Page, timeout_s: int = 40) -> Frame:
    """
    Wait for the Power BI iframe to load and the StreetName slicer to appear.
    The iframe URL starts with app.powerbi.com/view.
    """
    deadline = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < deadline:
        for frame in page.frames:
            if "app.powerbi.com/view" in frame.url:
                if await frame.locator(STREET_TRIGGER).count() > 0:
                    log.info(f"Power BI frame ready: {frame.url[:80]}...")
                    return frame
        await asyncio.sleep(1)
    raise RuntimeError("Power BI frame with StreetName slicer not found after waiting.")


SELECT_ALL_TITLES = {"בחר הכול", "Select all"}


async def focus_and_type(frame: Frame, locator, text: str):
    """
    Focus an Angular/Power BI input via JS (bypasses visibility) then type
    using page.keyboard so real key events are fired that Angular reacts to.
    """
    page = frame.page
    handle = await locator.element_handle()
    # JS click+focus bypasses Playwright's visibility check
    await frame.evaluate("el => { el.focus(); el.click(); }", handle)
    # Select-all then type replaces any existing text
    await page.keyboard.press("Control+a")
    await page.keyboard.press("Delete")
    await page.keyboard.type(text, delay=60)


async def scrape_population(frame: Frame, street_name: str) -> int | None:
    trigger = frame.locator(STREET_TRIGGER)

    popup_id = await trigger.get_attribute("aria-controls")

    # Open the dropdown
    await trigger.dispatch_event("click")
    await frame.wait_for_timeout(700)

    if popup_id:
        search_input = frame.locator(f"#{popup_id} input.searchInput")
        items = frame.locator(f"#{popup_id} .slicerItemContainer")
    else:
        search_input = frame.locator("input.searchInput").first
        items = frame.locator(".slicerContainer .slicerItemContainer")

    # Type the street name using real keyboard events Angular can detect
    await focus_and_type(frame, search_input, street_name)
    await frame.wait_for_timeout(300)

    # Enter sometimes closes the dropdown — reopen if needed
    if await trigger.get_attribute("aria-expanded") != "true":
        await trigger.dispatch_event("click")
        await frame.wait_for_timeout(400)

    # Poll until the list filters (first item is no longer "select all"), up to 5s
    for _ in range(20):
        await frame.wait_for_timeout(250)
        if await items.count() >= 1:
            first_title = await items.nth(0).get_attribute("title") or ""
            if first_title not in SELECT_ALL_TITLES:
                break

    count = await items.count()
    if count < 1:
        log.warning(f"  No slicer results for '{street_name}'")
        await _clear_search(frame, popup_id)
        return None

    first_title = await items.nth(0).get_attribute("title") or ""
    if first_title in SELECT_ALL_TITLES:
        log.warning(f"  List did not filter for '{street_name}' — no match found")
        await _clear_search(frame, popup_id)
        return None

    matched = first_title
    log.info(f"  Slicer matched: '{matched}'")
    await items.nth(0).dispatch_event("click")

    # Wait for Power BI visuals to update
    await frame.wait_for_timeout(1500)

    # Read population card: <text class="value"><tspan>233343</tspan></text>
    population = None
    try:
        pop_el = frame.locator("text.value tspan").first
        await pop_el.wait_for(state="visible", timeout=8000)
        raw = await pop_el.text_content()
        if raw:
            population = int(raw.replace(",", "").strip())
    except Exception as e:
        log.warning(f"  Could not read population value: {e}")

    # Uncheck the selected item and close the dropdown
    await _reset_slicer(frame, popup_id)

    return population


async def _clear_search(frame: Frame, popup_id: str | None):
    """Close the dropdown after a failed search, clearing the typed text."""
    try:
        trigger = frame.locator(STREET_TRIGGER)
        if await trigger.get_attribute("aria-expanded") != "true":
            await trigger.dispatch_event("click")
            await frame.wait_for_timeout(600)

        if popup_id:
            search_input = frame.locator(f"#{popup_id} input.searchInput")
        else:
            search_input = frame.locator("input.searchInput").first

        await focus_and_type(frame, search_input, "")
        await frame.wait_for_timeout(300)
        await trigger.dispatch_event("click")
        await frame.wait_for_timeout(400)
    except Exception:
        pass


async def _reset_slicer(frame: Frame, popup_id: str | None):
    """
    Deselect the current street and close the dropdown.

    We deselect BEFORE clearing the search — while the filtered list still shows
    only the selected street — so it's always visible and never scrolled out of
    the virtual list. After deselecting we clear the text and close.
    Never touch 'בחר הכול' / 'Select all' — clicking that selects everything.
    """
    try:
        trigger = frame.locator(STREET_TRIGGER)

        # Reopen if the dropdown closed after selection
        if await trigger.get_attribute("aria-expanded") != "true":
            await trigger.dispatch_event("click")
            await frame.wait_for_timeout(800)

        if popup_id:
            search_input = frame.locator(f"#{popup_id} input.searchInput")
            items = frame.locator(f"#{popup_id} .slicerItemContainer")
        else:
            search_input = frame.locator("input.searchInput").first
            items = frame.locator(".slicerItemContainer")

        # The filtered list still shows the selected street — click it to deselect
        for i in range(await items.count()):
            title = await items.nth(i).get_attribute("title") or ""
            if title not in SELECT_ALL_TITLES:
                await items.nth(i).dispatch_event("click")
                await frame.wait_for_timeout(200)
                break

        # Now clear the search text so the list resets for the next run
        await focus_and_type(frame, search_input, "")
        await frame.wait_for_timeout(400)

        # Close the dropdown
        await trigger.dispatch_event("click")
        await frame.wait_for_timeout(400)
    except Exception:
        pass


async def main():
    client = AsyncIOMotorClient(
        MONGODB_URL,
        tls=True,
        tlsCAFile=certifi.where(),
        tlsAllowInvalidCertificates=True,
    )
    col = client[DATABASE_NAME][COLLECTION]

    shelters = await col.find(
        {"$or": [{"demographicPotential": {"$exists": False}}, {"demographicPotential": 0}]},
        {"_id": 1, "address": 1},
    ).to_list(length=None)

    if not shelters:
        log.info("All shelters in ShelterTest already have demographicPotential.")
        return

    log.info(f"Found {len(shelters)} shelters to process.")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)  # set True once confirmed working
        page = await browser.new_page()

        log.info("Loading dashboard...")
        await page.goto(DASHBOARD_URL, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(5000)

        frame = await get_pbi_frame(page)

        updated = 0
        failed = []
        # Cache scraped populations per unique street to avoid duplicate work
        street_cache: dict[str, int | None] = {}

        for shelter in shelters:
            raw_address = shelter.get("address", "")
            if not raw_address:
                log.warning(f"Shelter {shelter['_id']} has no address — skipping.")
                continue

            street_name = extract_street_name(raw_address)

            # Reuse the cached result if we've already looked up this street
            if street_name in street_cache:
                population = street_cache[street_name]
                source = "cached"
            else:
                log.info(f"Processing: '{raw_address}'  →  searching '{street_name}'")
                try:
                    population = await scrape_population(frame, street_name)
                except Exception as e:
                    log.error(f"  Unexpected error: {e}")
                    population = None
                street_cache[street_name] = population
                source = "scraped"

            if population is not None:
                await col.update_one(
                    {"_id": shelter["_id"]},
                    {"$set": {"demographicPotential": population}},
                )
                if source == "scraped":
                    log.info(f"  ✓ demographicPotential = {population:,}")
                else:
                    log.info(f"  ✓ '{street_name}' (cached) = {population:,}")
                updated += 1
            else:
                failed.append(
                    {"id": shelter["_id"], "address": raw_address, "street": street_name}
                )

        # --- Fallback: assign the average to shelters that never got a value ---
        if failed:
            scraped_values = [v for v in street_cache.values() if v is not None]
            if scraped_values:
                # Filter out the city-total outliers (e.g. 233343) so they don't
                # skew the average — anything wildly above the typical street is dropped
                normal = [v for v in scraped_values if v < 10000]
                fallback = int(sum(normal) / len(normal)) if normal else int(
                    sum(scraped_values) / len(scraped_values)
                )
                log.info(
                    f"\nApplying fallback (avg of {len(normal) or len(scraped_values)} streets) "
                    f"= {fallback:,} to {len(failed)} unresolved shelters."
                )
                for f in failed:
                    await col.update_one(
                        {"_id": f["id"]},
                        {"$set": {"demographicPotential": fallback}},
                    )
                    log.info(f"  ↳ '{f['address']}' → {fallback:,} (fallback)")

        await browser.close()
    client.close()

    log.info(f"\nDone. Resolved by scrape: {updated} | Filled by fallback: {len(failed)}")


if __name__ == "__main__":
    asyncio.run(main())
