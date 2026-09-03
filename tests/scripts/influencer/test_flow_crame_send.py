"""Sélecteur du bouton d'envoi Agent Flow (UI 2026-09) — sans navigateur."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'flow-crame.py'
)
sys_path_parent = str(SCRIPT.parent)


def _load():
    import sys

    sys.path.insert(0, sys_path_parent)
    spec = importlib.util.spec_from_file_location('flow_crame', SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


flow_crame = _load()


class FlowCrameSendSelectorTest(unittest.TestCase):
    def test_send_button_is_arrow_forward_creer_narrow(self) -> None:
        self.assertTrue(
            flow_crame.looks_like_agent_send_button('arrow_forward\nCréer', 32)
        )

    def test_add_media_creer_is_not_the_send_button(self) -> None:
        # Bouton voisin `add_2 Créer` : même largeur, autre icône.
        self.assertFalse(
            flow_crame.looks_like_agent_send_button('add_2\nCréer', 32)
        )

    def test_wide_cta_is_rejected(self) -> None:
        self.assertFalse(
            flow_crame.looks_like_agent_send_button('arrow_forward\nCréer', 120)
        )

    def test_zero_width_invisible_button_is_rejected(self) -> None:
        self.assertFalse(
            flow_crame.looks_like_agent_send_button('arrow_forward\nCréer', 0)
        )

    def test_ready_requires_aria_disabled_false_not_html_disabled(self) -> None:
        # Régression FLOWFIX1 : .disabled HTML restait false, aria-disabled=true.
        self.assertFalse(
            flow_crame.agent_send_is_ready(disabled=False, aria_disabled='true')
        )
        self.assertTrue(
            flow_crame.agent_send_is_ready(disabled=False, aria_disabled='false')
        )
        self.assertTrue(
            flow_crame.agent_send_is_ready(disabled=False, aria_disabled=None)
        )
        self.assertFalse(
            flow_crame.agent_send_is_ready(disabled=True, aria_disabled='false')
        )


if __name__ == '__main__':
    unittest.main()
