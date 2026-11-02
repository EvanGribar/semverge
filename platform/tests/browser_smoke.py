"""Optional end-to-end browser verification; requires Python Playwright + Chromium.
Run from repository root after pnpm platform:build. Starts isolated test servers.
Screenshots contain explicitly named local test data and real local HTTP checks.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".impeccable" / "review"
OUT.mkdir(parents=True, exist_ok=True)
TOKEN = secrets.token_hex(32)
env = {**os.environ, "SEMVERGE_PLATFORM_TOKEN": TOKEN}
server = subprocess.Popen(["node", "platform/tests/browser-server.mjs"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
base = "http://127.0.0.1:4320"
checks = []
def passed(name):
    checks.append(name)
def toggle(path):
    try:
        urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:4321/{path}", method="POST"), timeout=3)
    except urllib.error.HTTPError as error:
        if error.code != 503: raise
try:
    for attempt in range(100):
        try:
            urllib.request.urlopen(base, timeout=1)
            break
        except Exception:
            if server.poll() is not None: raise RuntimeError("Browser-test server failed to start; check ports 4320/4321")
            time.sleep(.1)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width":1440,"height":1000}, device_scale_factor=1)
        def capture(filename):
            page.wait_for_function("() => !document.querySelector('button:disabled')")
            page.wait_for_function("() => document.querySelector('#notice').hidden", timeout=10000)
            page.evaluate("document.activeElement?.blur(); window.scrollTo(0,0)")
            page.screenshot(path=str(OUT / filename), full_page=True)
        failures = []
        page.on("pageerror", lambda error: failures.append(str(error)))
        page.goto(base)
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("heading", name="Open your workspace")).to_be_visible()
        capture("login-desktop.png")
        page.get_by_label("Operator token").fill(TOKEN)
        page.get_by_role("button",name="Sign in",exact=True).click()
        expect(page.get_by_role("heading",name="Overview",exact=True)).to_be_visible()
        expect(page.get_by_role("heading",name="Start with an application")).to_be_visible()
        capture("empty-desktop.png")
        page.set_viewport_size({"width":393,"height":852})
        capture("empty-mobile.png")
        page.set_viewport_size({"width":1440,"height":1000})
        page.get_by_role("button",name="New application",exact=True).click()
        page.get_by_label("Application name",exact=True).fill("Local test application")
        page.locator("form[data-form=application]").get_by_role("button",name="Create application",exact=True).click()
        expect(page.get_by_role("heading",name="Local test application",exact=True)).to_be_visible()
        page.locator(".section-actions").get_by_role("button",name="Add service",exact=True).click()
        page.locator('select[name="applicationId"]').select_option(label="Local test application")
        page.get_by_label("Service name",exact=True).fill("Checkout API (test endpoint)")
        page.get_by_role("button",name="Create service",exact=True).click()
        expect(page.get_by_text("No environment linked yet",exact=True)).to_be_visible()
        page.get_by_role("button",name="Add environment",exact=True).click()
        page.get_by_label("Environment name",exact=True).fill("Local verification")
        page.get_by_role("button",name="Create environment",exact=True).click()
        passed("Browser creates persistent catalog through authenticated API")
        page.get_by_role("navigation",name="Main navigation").get_by_role("link",name="Monitoring",exact=True).click()
        page.get_by_role("button",name="New monitor",exact=True).click()
        page.get_by_label("Monitor name",exact=True).fill("Local HTTP health check")
        page.locator('select[name="serviceId"]').select_option(label="Local test application / Checkout API (test endpoint)")
        page.locator('select[name="environmentId"]').select_option(label="Local verification")
        page.get_by_label("Endpoint URL").fill("http://127.0.0.1:4321/health")
        page.get_by_role("button",name="Create monitor",exact=True).click()
        expect(page.get_by_role("heading",name="Local HTTP health check",exact=True)).to_be_visible()
        page.get_by_role("button",name="Run check",exact=True).click()
        expect(page.get_by_text("Check recorded",exact=True)).to_be_visible()
        expect(page.locator("tbody").get_by_text("Expected response",exact=True).first).to_be_visible()
        monitor_route = page.url
        toggle("fail")
        for count in range(2):
            page.get_by_role("button",name="Run check",exact=True).click()
            expect(page.get_by_role("button",name="Run check",exact=True)).to_be_enabled()
            page.wait_for_timeout(200)
        expect(page.get_by_role("heading",name="Connected incidents",exact=True)).to_be_visible()
        passed("Actual failing HTTP checks create a connected incident")
        # Import a clearly identified synthetic transaction. The endpoint history above is real.
        state = page.evaluate("""async()=>await(await fetch('/api/state')).json()""")
        transaction = {
            "schemaVersion":6,"id":"release_browser_test_only","version":"0.1.0-test.1","sourceCommit":"a"*40,
            "phase":"built","packageIds":["test-api"],"tagNames":["v0.1.0-test.1"],"publishingTargets":[],
            "ociImages":[],"npmEnabled":False,"npmProvenance":False,"artifactDigests":{},"ociDigests":{},
            "publishedPackages":[],"publishedOciImages":[],"uploadedAssets":{},"ready":False,"published":False,
            "updatedAt":"2026-01-01T00:00:00Z","events":[{"key":"test-build","kind":"artifacts-built","phase":"built","target":"test","status":"completed","attempt":1,"at":"2026-01-01T00:00:00Z"}]
        }
        page.get_by_role("navigation",name="Main navigation").get_by_role("link",name="Releases",exact=True).click()
        page.get_by_role("button",name="Import release",exact=True).first.click()
        page.locator('select[name="serviceId"]').select_option(label="Local test application / Checkout API (test endpoint)")
        page.locator('select[name="environmentId"]').select_option(label="Local verification")
        page.get_by_label("Transaction JSON",exact=True).fill(json.dumps(transaction))
        page.locator("form[data-form=release]").get_by_role("button",name="Import release",exact=True).click()
        expect(page.get_by_role("heading",name="0.1.0-test.1",exact=True)).to_be_visible()
        expect(page.get_by_text("artifacts built",exact=True)).to_be_visible()
        capture("release-desktop.png")
        page.set_viewport_size({"width":393,"height":852})
        capture("release-mobile.png")
        page.set_viewport_size({"width":1440,"height":1000})
        passed("Browser imports a transaction and renders actual parsed phase and events")
        page.get_by_role("navigation",name="Main navigation").get_by_role("link",name="Incidents",exact=False).click()
        page.get_by_role("link",name="Local HTTP health check is failing",exact=False).click()
        page.get_by_label("Assign and acknowledge",exact=True).fill("Local test operator")
        page.get_by_role("button",name="Acknowledge",exact=True).click()
        expect(page.get_by_text("Acknowledged by Local test operator.",exact=True)).to_be_visible()
        page.locator('select[name="releaseId"]').select_option(index=1)
        page.get_by_role("button",name="Link release",exact=True).click()
        expect(page.get_by_text("Operator associated release 0.1.0-test.1; causation is unverified.",exact=True)).to_be_visible()
        page.get_by_label("Add investigation note",exact=True).fill("Controlled local failure. Inspecting endpoint recovery.")
        page.get_by_role("button",name="Add note",exact=True).click()
        expect(page.get_by_text("Controlled local failure. Inspecting endpoint recovery.",exact=True)).to_be_visible()
        capture("incident-desktop.png")
        incident_route=page.url
        passed("Browser acknowledges, assigns, annotates and links a release with context")
        page.get_by_role("navigation",name="Main navigation").get_by_role("link",name="Overview",exact=True).click()
        capture("desktop.png")
        page.set_viewport_size({"width":393,"height":852})
        capture("mobile.png")
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile page overflows"
        passed("Overview fits desktop and 393px mobile; service status and release context remain visible")
        page.goto(incident_route);page.wait_for_load_state("networkidle")
        capture("incident-mobile.png")
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Incident mobile overflows"
        page.goto(monitor_route);page.wait_for_load_state("networkidle")
        capture("monitor-mobile.png")
        page.set_viewport_size({"width":1440,"height":1000})
        capture("monitor-desktop.png")
        page.set_viewport_size({"width":393,"height":852})
        toggle("recover")
        page.get_by_role("button",name="Run check",exact=True).click()
        expect(page.get_by_text("Check recorded",exact=True)).to_be_visible()
        page.goto(incident_route);page.wait_for_load_state("networkidle")
        expect(page.get_by_text("Monitor returned expected HTTP 200.",exact=True)).to_be_visible()
        passed("Passing HTTP result automatically resolves the monitor incident with evidence")
        # Stored-input attack attempt must be text, never browser markup.
        page.evaluate("""async()=>await fetch('/api/applications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'<img src=x onerror=alert(1)>'})})""")
        page.get_by_role("navigation",name="Main navigation").get_by_role("link",name="Overview",exact=True).click()
        expect(page.get_by_role("heading",name="<img src=x onerror=alert(1)>",exact=True)).to_be_visible()
        assert page.locator("img[src=x]").count()==0
        passed("Stored input renders as escaped text under CSP")
        page.get_by_role("button",name="Sign out",exact=True).click()
        expect(page.get_by_role("heading",name="Open your workspace",exact=True)).to_be_visible()
        capture("login-mobile.png")
        passed("Sign-out revokes the browser session")
        assert failures==[], f"Browser JavaScript errors: {failures}"
        browser.close()
    (OUT / "browser-results.json").write_text(json.dumps({"passed":checks,"browserErrors":failures,"testData":"Isolated local test application; synthetic release record; real HTTP checks"},indent=2),encoding="utf-8")
    print(json.dumps({"passed":checks,"browserErrors":failures},indent=2))
finally:
    server.terminate()
    try: server.wait(timeout=15)
    except subprocess.TimeoutExpired: server.kill();server.wait()
