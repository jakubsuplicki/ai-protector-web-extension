"""CORS origin policy for the self-hosted engine.

The self-hosted engine is the browser extension's backend. The extension's
origin is an opaque, per-install `chrome-extension://<id>` (or `moz-extension`
on Firefox), so we allow the extension *schemes* via regex rather than listing
IDs. These tests pin that contract so a future change can't silently widen it
to arbitrary web origins (which would let any visited site call the local DLP
engine) or narrow it so the extension breaks.
"""

import re

from src.main_self_hosted import EXTENSION_ORIGIN_REGEX

_pattern = re.compile(EXTENSION_ORIGIN_REGEX)


class TestExtensionOriginRegex:
    def test_allows_chrome_extension_origin(self):
        assert _pattern.match("chrome-extension://abcdefghijklmnopabcdefghij")

    def test_allows_firefox_extension_origin(self):
        assert _pattern.match("moz-extension://0123456789abcdef")

    def test_rejects_arbitrary_https_web_origin(self):
        # The whole point: a random site you visit must NOT be able to reach
        # the local engine.
        assert _pattern.match("https://evil.example.com") is None

    def test_rejects_http_localhost_web_origin(self):
        # Web localhost is handled by the explicit allowlist, not this regex.
        assert _pattern.match("http://localhost:3000") is None

    def test_rejects_extension_origin_with_path_or_port(self):
        # Extension origins are scheme://id with no port or path; anything else
        # is suspicious and must not match.
        assert _pattern.match("chrome-extension://abc/evil") is None
        assert _pattern.match("chrome-extension://abc:8000") is None

    def test_rejects_scheme_only_or_empty(self):
        assert _pattern.match("chrome-extension://") is None
        assert _pattern.match("") is None
