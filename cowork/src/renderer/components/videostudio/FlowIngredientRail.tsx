import { useMemo, useState } from 'react';
import { ImagePlus, Search } from 'lucide-react';
import type { FlowIngredient } from './flow-studio-model';

export function FlowIngredientRail({
  ingredients,
  selectedIds,
  onToggle,
  onAdd,
}: {
  ingredients: FlowIngredient[];
  selectedIds: string[];
  onToggle: (ingredient: FlowIngredient) => void;
  onAdd: () => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | FlowIngredient['kind']>('all');
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return ingredients.filter((item) => (kind === 'all' || item.kind === kind) && (!normalized || item.name.toLowerCase().includes(normalized)));
  }, [ingredients, kind, query]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <aside className="flex h-52 min-h-0 w-full shrink-0 flex-col border-b border-border bg-surface lg:h-auto lg:w-56 lg:border-b-0 lg:border-r" data-testid="flow-ingredient-rail">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <h2 className="text-xs font-semibold text-foreground">Ingrédients</h2>
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground hover:bg-background" data-testid="flow-add-ingredient">
          <ImagePlus className="h-3.5 w-3.5" /> Ajouter
        </button>
      </div>
      <label className="mx-3 mt-3 flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher…" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" aria-label="Rechercher un ingrédient" />
      </label>
      <div className="flex gap-1 overflow-x-auto px-3 pt-2" aria-label="Collections d’ingrédients">
        {([
          ['all', 'Tous'],
          ['character', 'Personnages'],
          ['object', 'Objets'],
          ['place', 'Lieux'],
          ['style', 'Styles'],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setKind(value)} className={`shrink-0 rounded px-2 py-1 text-[9px] ${kind === value ? 'bg-orange-500 text-white' : 'bg-background text-muted-foreground hover:text-foreground'}`} aria-pressed={kind === value}>{label}</button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-2 gap-2 overflow-y-auto p-3">
        {visible.map((ingredient) => {
          const selected = selectedIdSet.has(ingredient.id);
          return (
            <button key={ingredient.id} type="button" onClick={() => onToggle(ingredient)} className={`overflow-hidden rounded-lg border text-left transition ${selected ? 'border-orange-500 ring-2 ring-orange-500/15' : 'border-border hover:border-muted-foreground/40'}`} aria-pressed={selected} data-testid={`flow-ingredient-${ingredient.id}`}>
              <img src={ingredient.url} alt="" className="aspect-[4/3] w-full bg-muted object-cover" />
              <span className="block truncate px-2 pt-1.5 text-[10px] font-medium text-foreground">{ingredient.name}</span>
              <span className="block truncate px-2 pb-1.5 text-[8px] text-muted-foreground">{ingredient.source === 'mysoulmate' ? 'MySoulmate · validé' : ingredient.source === 'avatar-bible' ? 'Bible avatar' : 'Workspace'}</span>
            </button>
          );
        })}
        {visible.length === 0 ? <p className="col-span-2 py-8 text-center text-[11px] text-muted-foreground">Ajoute des images pour créer des personnages, lieux et styles cohérents.</p> : null}
      </div>
    </aside>
  );
}
