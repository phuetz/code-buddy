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
    import os
    import sys

    # Le script exige FLOW_PROJECT_ID (aucun identifiant de projet en dur dans le
    # dépôt public) : on fournit une valeur factice pour pouvoir l'importer.
    os.environ.setdefault('FLOW_PROJECT_ID', 'projet-de-test')
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


class FlowProjectIdIsMandatoryTest(unittest.TestCase):
    """Sans FLOW_PROJECT_ID, le script s'arrête avec un message explicite."""

    def test_missing_env_var_aborts_with_a_clear_message(self) -> None:
        import importlib.util
        import os
        import sys

        previous = os.environ.pop('FLOW_PROJECT_ID', None)
        try:
            sys.path.insert(0, sys_path_parent)
            spec = importlib.util.spec_from_file_location('flow_crame_no_env', SCRIPT)
            assert spec and spec.loader
            module = importlib.util.module_from_spec(spec)
            with self.assertRaises(SystemExit) as ctx:
                spec.loader.exec_module(module)
            self.assertIn('FLOW_PROJECT_ID', str(ctx.exception))
        finally:
            if previous is not None:
                os.environ['FLOW_PROJECT_ID'] = previous
            sys.modules.pop('flow_crame_no_env', None)

    def test_no_hardcoded_project_uuid_in_the_script(self) -> None:
        import re

        source = SCRIPT.read_text(encoding='utf-8')
        uuid_like = re.compile(
            r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
            r'[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
        )
        self.assertEqual([], uuid_like.findall(source))


if __name__ == '__main__':
    unittest.main()
