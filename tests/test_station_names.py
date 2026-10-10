"""Strings third parties see must not present 1Ultra as StarNet."""
import unittest
from pathlib import Path

STATION = Path(__file__).resolve().parents[1] / 'station'
FORBIDDEN = {
    'sidecar/tools/builtin/image.js': ["codex_cli_rs/0.0.0 (StarNet)", "'X-Title': 'STARNET'", "https://starnet.local"],
    'sidecar/providers/openrouter.js': ["'X-Title': 'STARNET'"],
    'sidecar/media-service.js': ["'X-Title': 'STARNET'"],
    'sidecar/mcp/oauth.js': ["client_name: opts.clientName || 'StarNet'"],
    'sidecar/mcp/client.js': ["name: 'starnet-harness'"],
}


class ThirdPartyNamesTest(unittest.TestCase):
    def test_no_starnet_identity_in_outbound_requests(self):
        for rel, needles in FORBIDDEN.items():
            text = (STATION / rel).read_text()
            for needle in needles:
                self.assertNotIn(needle, text, f'{rel} still sends {needle!r}')


if __name__ == '__main__':
    unittest.main()
