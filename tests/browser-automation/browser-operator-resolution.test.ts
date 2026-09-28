import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { executeDOMInspectionScript } from '../../src/browser-automation/browser-operator-executor.js';

function executeIntentResolution(html: string, intent: string) {
  const dom = new JSDOM(html);

  const context = {
    document: dom.window.document,
    location: dom.window.location,
    globalThis: { CSS: { escape: (v: string) => v } }
  };

  const input = {
    selectorGroups: [],
    intent: intent,
    useActiveElement: false,
    allowIntentFallback: true
  };

  // We can't directly call executeDOMInspectionScript(input) because it uses `document` and `location`
  // from the global scope, which in Node are not the JSDOM ones by default.
  // We recreate its body within the JSDOM window context.
  const fnString = executeDOMInspectionScript.toString();
  const functionBody = fnString.substring(fnString.indexOf('{') + 1, fnString.lastIndexOf('}'));

  const executeFn = new Function('input', 'document', 'location', 'globalThis', functionBody);

  return executeFn(input, context.document, context.location, context.globalThis);
}

describe('Browser Operator Intent Resolution', () => {
  it('resolves FR and EN exact intent via button text', () => {
    const html = `
      <!DOCTYPE html>
      <html><body>
        <button id="btn-fr">Valider</button>
        <button id="btn-en">Submit</button>
      </body></html>
    `;

    const resFr = executeIntentResolution(html, 'clique sur Valider');
    expect(resFr.targetFound).toBe(true);
    expect(resFr.resolvedSelectors[0]).toBe('#btn-fr');

    const resEn = executeIntentResolution(html, 'click on Submit');
    expect(resEn.targetFound).toBe(true);
    expect(resEn.resolvedSelectors[0]).toBe('#btn-en');
  });

  it('resolves ambiguous input via placeholder', () => {
    const html = `
      <!DOCTYPE html>
      <html><body>
        <input type="text" id="email" placeholder="e-mail" />
        <button>Valider</button>
      </body></html>
    `;

    const res = executeIntentResolution(html, 'remplis le champ e-mail');
    // Before fix, this fails to find because placeholder is missing in haystack and stopwords dilute score
    expect(res.targetFound).toBe(true);
    expect(res.resolvedSelectors[0]).toBe('#email');
  });

  it('resolves ambiguous input via title', () => {
    const html = `
      <!DOCTYPE html>
      <html><body>
        <input type="text" id="search" title="Rechercher sur le site" />
      </body></html>
    `;

    const res = executeIntentResolution(html, 'lance la recherche');
    // Before fix, this fails to find because title is missing in haystack
    expect(res.targetFound).toBe(true);
    expect(res.resolvedSelectors[0]).toBe('#search');
  });

  it('handles renamed or moved elements gracefully', () => {
    const html = `
      <!DOCTYPE html>
      <html><body>
        <div class="old-container"></div>
        <div class="new-container">
          <button id="send-btn">Envoyer</button>
        </div>
      </body></html>
    `;

    const res = executeIntentResolution(html, 'clique sur Envoyer le message');
    expect(res.targetFound).toBe(true);
    expect(res.resolvedSelectors[0]).toBe('#send-btn');
  });

  it('resolves ambiguous short instructions based on intent fallback', () => {
    const html = `
      <!DOCTYPE html>
      <html><body>
        <a href="#" id="link">Lien</a>
        <button id="btn-only">Bouton de validation</button>
      </body></html>
    `;

    const res = executeIntentResolution(html, 'bouton');
    expect(res.targetFound).toBe(true);
    expect(res.resolvedSelectors[0]).toBe('#btn-only');
  });

  it('handles missing element correctly', () => {
    const html = `
      <!DOCTYPE html>
      <html><body>
        <button id="btn-valider">Valider</button>
      </body></html>
    `;

    const res = executeIntentResolution(html, 'clique sur Annuler');
    expect(res.targetFound).toBe(false);
    expect(res.resolvedSelectors).toHaveLength(0);
  });
});
