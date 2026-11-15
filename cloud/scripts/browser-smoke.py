import json
import os
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


def submit(page, label, path, origin):
    with page.expect_response(
        lambda response: response.url == origin + path and response.request.method == "POST"
    ) as posted:
        page.get_by_role("button", name=label, exact=True).click()
    response = posted.value
    sent_origin = response.request.header_value("origin")
    assert sent_origin == origin, f"{label}: expected Origin {origin}, got {sent_origin}"
    assert response.status == 303, f"{label}: expected 303, got {response.status}"
    return response.headers["location"]


def check(browser_type, name, token, origin):
    with browser_type.launch() as browser:
        context = browser.new_context()
        context.add_cookies([{"name": "semverge_session", "value": token, "url": origin}])
        # End the OAuth navigation locally after recording Cloud's real redirect.
        context.route("https://github.com/login/oauth/authorize?**", lambda route: route.fulfill(body="OAuth fixture"))
        page = context.new_page()
        page.set_default_timeout(7_500)
        workspace_url = origin + "/workspaces?source=browser-smoke"
        page.goto(workspace_url)
        expect(page.get_by_role("heading", name="Browser fixture")).to_be_visible()
        page.locator('input[name="repository"]').fill("fixture/private-repo")
        location = submit(page, "Connect repository", "/api/auth/github", origin)
        assert urlparse(location)._replace(query="", fragment="").geturl() == "https://github.com/login/oauth/authorize"

        page.goto(workspace_url)
        assert submit(page, "Sign out", "/api/auth/sign-out", origin) == origin + "/workspaces"
        expect(page.get_by_role("link", name="Sign in with GitHub")).to_be_visible()
    print(f"{name}: repository connection and sign-out forms preserved Origin", flush=True)


if __name__ == "__main__":
    origin = os.environ["CLOUD_TEST_ORIGIN"]
    sessions = json.loads(os.environ["CLOUD_TEST_SESSIONS"])
    with sync_playwright() as playwright:
        for name in ("chromium", "firefox"):
            check(getattr(playwright, name), name, sessions[name], origin)
