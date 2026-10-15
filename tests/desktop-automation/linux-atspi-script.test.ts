/**
 * Le script AT-SPI de SmartSnapshotManager est exécuté pour de vrai par python3,
 * contre un faux module `gi` qui reproduit l'arbre mesuré le 28/09/2026 sous Xvfb
 * sur une fenêtre Avalonia 12 : le bouton « Valider » y est à la profondeur 6
 * depuis le nœud application. L'ancienne limite de profondeur (5) le perdait.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildLinuxAtspiScript,
  LINUX_ATSPI_DEFAULT_MAX_DEPTH,
} from '../../src/desktop-automation/smart-snapshot.js';

function hasPython3(): boolean {
  try {
    execFileSync('python3', ['-c', 'print(1)'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Faux PyGObject : seulement ce que le script appelle.
const FAKE_GI_INIT = `
def require_version(name, version):
    pass
`;

const FAKE_REPOSITORY = `
class _Rect:
    def __init__(self, x, y, w, h):
        self.x, self.y, self.width, self.height = x, y, w, h

class _Component:
    def __init__(self, rect):
        self._rect = rect
    def get_extents(self, coord_type):
        return self._rect

class _Node:
    def __init__(self, role, name, rect=(0, 0, 0, 0), children=()):
        self.role, self.name = role, name
        self.rect = _Rect(*rect)
        self.children = list(children)
    def get_component(self):
        return _Component(self.rect)
    def get_child_count(self):
        return len(self.children)
    def get_child_at_index(self, i):
        return self.children[i]

class _CoordType:
    SCREEN = 0

class _Accessible:
    @staticmethod
    def get_role_name(obj):
        return obj.role
    @staticmethod
    def get_name(obj):
        return obj.name

def _chain(names, leaf):
    node = leaf
    for n in reversed(names):
        node = _Node("panel", n, (10, 10, 420, 260), [node])
    return node

_button = _Node("push button", "Valider", (188, 142, 64, 33))
_label = _Node("label", "Compteur : 0", (177, 106, 86, 20))
_stack = _Node("panel", "StackPanel", (177, 106, 86, 69), [_label, _button])
_frame = _Node("frame", "Compteur Démo", (10, 10, 420, 260),
               [_chain(["Panel", "VisualLayerManager", "ContentPresenter"], _stack)])
_app = _Node("application", "Avalonia Application", children=[_frame])
_desktop = _Node("desktop frame", "main", children=[_app])

class Atspi:
    Accessible = _Accessible
    CoordType = _CoordType
    @staticmethod
    def get_desktop(i):
        return _desktop
`;

describe.skipIf(!hasPython3())('script AT-SPI Linux (python3 réel, faux gi)', () => {
  let dir = '';

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-atspi-'));
    fs.mkdirSync(path.join(dir, 'gi'));
    fs.writeFileSync(path.join(dir, 'gi', '__init__.py'), FAKE_GI_INIT);
    fs.writeFileSync(path.join(dir, 'gi', 'repository.py'), FAKE_REPOSITORY);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function run(maxDepth: number, maxElements: number): Array<{ role: string; name: string }> {
    const out = execFileSync('python3', ['-c', buildLinuxAtspiScript(maxDepth, maxElements)], {
      env: { ...process.env, PYTHONPATH: dir },
      encoding: 'utf-8',
    });
    return JSON.parse(out) as Array<{ role: string; name: string }>;
  }

  it('trouve le bouton Avalonia à la profondeur 6 avec la profondeur par défaut', () => {
    const els = run(LINUX_ATSPI_DEFAULT_MAX_DEPTH, 500);
    expect(els).toContainEqual(expect.objectContaining({ role: 'push button', name: 'Valider' }));
    expect(els).toContainEqual(expect.objectContaining({ role: 'label', name: 'Compteur : 0' }));
  });

  it("l'ancienne limite de profondeur 5 perdait le bouton (témoin de l'échec corrigé)", () => {
    const els = run(5, 500);
    expect(els.map((e) => e.name)).toContain('StackPanel');
    expect(els.map((e) => e.name)).not.toContain('Valider');
  });

  it("s'arrête dès maxElements nœuds collectés", () => {
    expect(run(LINUX_ATSPI_DEFAULT_MAX_DEPTH, 3)).toHaveLength(3);
  });
});
