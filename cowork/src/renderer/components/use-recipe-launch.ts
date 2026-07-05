/**
 * useRecipeLaunch — tiny bridge from recipe cards to a parent composer.
 *
 * @module renderer/components/use-recipe-launch
 */
import { useCallback } from 'react';

export function useRecipeLaunch(send: (text: string) => void): (recipe: { prompt: string }) => void {
  return useCallback((recipe: { prompt: string }) => {
    send(recipe.prompt);
  }, [send]);
}
