from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        # Navigate to local server
        page.goto("http://localhost:3000/")

        # Wait for home page to load
        try:
            page.wait_for_selector("#home-balance", timeout=5000)
            print("Home page loaded")
        except:
            print("Timeout waiting for home page")
            page.screenshot(path="verification_error.png")
            browser.close()
            return

        # Check if balance is visible
        balance = page.locator("#home-balance").inner_text()
        print(f"Balance: {balance}")

        # Check if budget widget container exists
        if page.locator("#budget-widget-container").is_visible():
            print("Budget widget visible")

        # Take screenshot
        page.screenshot(path="verification_home.png")
        browser.close()

if __name__ == "__main__":
    run()
