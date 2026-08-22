/**
 * Deterministic prompt enhancer (bolt.new offers to enrich a terse prompt before
 * building). No LLM: detect what a description is missing (stack, styling,
 * concrete features) and propose short additions + an enriched prompt.
 */
export interface PromptEnhancement {
  suggestions: string[];
  enriched: string;
}

const STACK_RE = /\b(react|vue|next|svelte|angular|vite|html)\b/i;
const STYLE_RE = /\b(sombre|dark|thème|theme|couleur|color|responsive|design|moderne|épuré|epure|glass|néon|neon)\b/i;
const FEATURE_RE =
  /\b(todo|tâche|tache|liste|dashboard|graph|chart|form|formulaire|table|tableau|auth|login|calendrier|calendar|chat|carte|map|panier|cart|galerie|gallery|timer|blog)\b/i;

/** A description is vague when it's short or names no concrete feature. */
export function isVague(prompt: string): boolean {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  if (words.length < 6) return true;
  return !FEATURE_RE.test(prompt);
}

export function enhancePrompt(prompt: string): PromptEnhancement {
  const base = prompt.trim();
  const suggestions: string[] = [];
  const additions: string[] = [];

  if (!base) {
    return {
      suggestions: [
        'Describe a concrete app (e.g. "a todo app")',
        'Specify the style (e.g. dark theme, responsive)',
        'Name the key features',
      ],
      enriched: '',
    };
  }

  if (!STACK_RE.test(base)) {
    suggestions.push('Specify the stack (React + Vite)');
    additions.push('in React + Vite');
  }
  if (!STYLE_RE.test(base)) {
    suggestions.push('Add a style (polished dark theme, responsive)');
    additions.push('with a polished dark theme and a responsive layout');
  }
  if (!FEATURE_RE.test(base)) {
    suggestions.push('Detail the main features');
    additions.push('with the main features clearly separated into components');
  }
  if (suggestions.length === 0) {
    suggestions.push('The prompt is already precise — you can generate.');
  }

  const enriched = additions.length > 0 ? `${base}, ${additions.join(', ')}.` : base;
  return { suggestions, enriched };
}
