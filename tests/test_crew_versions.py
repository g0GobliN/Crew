"""One version for the whole package: plugin.yaml's.

Issue #15: plugin.yaml said 0.9.11 while skills/crew/SKILL.md said 0.8.1 and the role skills 0.2.0, and every
version-shaped check (install.py --check's headline included) read plugin.yaml only, so a skill whose body
changed and whose frontmatter did not looked current. The skill body is the text an agent copies into tool
calls, so its version is pinned to the release here.
"""
import json
import os
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def plugin_version():
    return re.search(r"^version:\s*(\S+)", (REPO / "plugin.yaml").read_text(encoding="utf-8"), re.M).group(1)


class VersionTests(unittest.TestCase):
    def test_every_shipped_skill_carries_the_plugin_version(self):
        want = plugin_version()
        skills = sorted((REPO / "skills").glob("*/SKILL.md"))
        self.assertTrue(skills)
        for p in skills:
            m = re.search(r"^version:\s*(\S+)", p.read_text(encoding="utf-8"), re.M)
            self.assertIsNotNone(m, "%s has no version line" % p.parent.name)
            self.assertEqual(want, m.group(1), "%s/SKILL.md version" % p.parent.name)

    def test_the_readme_badge_and_the_dashboard_manifest_match(self):
        want = plugin_version()
        badge = re.search(r"badge/version-([0-9.]+)-", (REPO / "README.md").read_text(encoding="utf-8"))
        self.assertEqual(want, badge.group(1), "README version badge")
        manifest = REPO / "dashboard" / "manifest.json"
        if manifest.exists():
            self.assertEqual(want, json.loads(manifest.read_text(encoding="utf-8")).get("version"))

    def test_the_registered_verifier_skill_reads_its_version_instead_of_a_literal(self):
        src = (REPO / "__init__.py").read_text(encoding="utf-8")
        self.assertNotRegex(src, r'frontmatter=\{"version":\s*"[0-9.]+"\}')


if __name__ == "__main__":
    unittest.main()
