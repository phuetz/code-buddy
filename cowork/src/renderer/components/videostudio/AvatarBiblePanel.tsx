import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Crown,
  ImagePlus,
  Pencil,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import type {
  AvatarBibleConsent,
  AvatarBibleEntry,
  AvatarBibleMetadataInput,
  AvatarBibleRights,
  AvatarBibleRole,
  AvatarBibleSnapshot,
} from '../../../shared/avatar-bible';

const ROLE_LABELS: Record<AvatarBibleRole, string> = {
  master: 'Référence maître',
  front: 'Vue de face',
  profile: 'Profil',
  expression: 'Expression',
  costume: 'Costume',
};

const RIGHTS_LABELS: Record<AvatarBibleRights, string> = {
  owned: 'Droits détenus',
  licensed: 'Licence autorisée',
  consented: 'Usage consenti',
};

const EMPTY_DRAFT: AvatarBibleMetadataInput = {
  name: '',
  role: 'front',
  rights: 'owned',
  consent: 'not-applicable',
  notes: '',
};

const MAX_EAGER_PREVIEWS = 24;
const MAX_EAGER_PREVIEW_SOURCE_BYTES = 24 * 1024 * 1024;

export interface AvatarBibleFlowAsset {
  id: string;
  name: string;
  path: string;
  url: string;
}

export interface AvatarBiblePanelProps {
  onUseAsset?: (asset: AvatarBibleFlowAsset) => void;
}

export function AvatarBiblePanel({ onUseAsset }: AvatarBiblePanelProps) {
  const [snapshot, setSnapshot] = useState<AvatarBibleSnapshot>();
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<AvatarBibleMetadataInput>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [pendingRemoveId, setPendingRemoveId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.avatarBible;
    if (!api) {
      setError('La bibliothèque d’avatars n’est pas disponible dans cette version de Cowork.');
      return;
    }
    setBusy('list');
    setError(undefined);
    try {
      const result = await api.list();
      if (!result.ok || !result.snapshot) throw new Error(result.error ?? 'Bibliothèque indisponible.');
      setSnapshot(result.snapshot);
      const previewAvatars = selectPreviewAvatars(result.snapshot);
      const previewResults = await Promise.all(previewAvatars.map(async (avatar) => {
        const preview = await api.preview({ id: avatar.id });
        return preview.ok && preview.dataUrl ? [avatar.id, preview.dataUrl] as const : null;
      }));
      setPreviews(Object.fromEntries(previewResults.filter((item): item is readonly [string, string] => item !== null)));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingId(undefined);
    setDraft(EMPTY_DRAFT);
  }, []);

  const startImport = useCallback(() => {
    setEditingId(undefined);
    setDraft(EMPTY_DRAFT);
    setFormOpen(true);
    setNotice(undefined);
  }, []);

  const startEdit = useCallback((avatar: AvatarBibleEntry) => {
    setEditingId(avatar.id);
    setDraft({
      name: avatar.name,
      role: avatar.role,
      rights: avatar.rights,
      consent: avatar.consent,
      notes: avatar.notes ?? '',
    });
    setFormOpen(true);
    setNotice(undefined);
  }, []);

  const submit = useCallback(async () => {
    const api = window.electronAPI?.avatarBible;
    if (!api || !draft.name.trim()) return;
    setBusy(editingId ?? 'import');
    setError(undefined);
    setNotice(undefined);
    try {
      const result = editingId
        ? await api.update({ id: editingId, ...draft })
        : await api.importImage(draft);
      if (!result.ok) throw new Error(result.error ?? 'Opération avatar impossible.');
      if (result.canceled) {
        setNotice('Import annulé : aucun fichier n’a été copié.');
        return;
      }
      closeForm();
      setNotice(editingId ? 'Métadonnées mises à jour.' : 'Image copiée dans la Bible privée du projet.');
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }, [closeForm, draft, editingId, refresh]);

  const setMaster = useCallback(async (id: string) => {
    const api = window.electronAPI?.avatarBible;
    if (!api) return;
    setBusy(id);
    setError(undefined);
    try {
      const result = await api.setMaster({ id });
      if (!result.ok || !result.snapshot) throw new Error(result.error ?? 'Sélection impossible.');
      setSnapshot(result.snapshot);
      setNotice('Nouvelle référence maître définie.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    if (pendingRemoveId !== id) {
      setPendingRemoveId(id);
      return;
    }
    const api = window.electronAPI?.avatarBible;
    if (!api) return;
    setBusy(id);
    setError(undefined);
    try {
      const result = await api.remove({ id });
      if (!result.ok || !result.snapshot) throw new Error(result.error ?? 'Suppression impossible.');
      setSnapshot(result.snapshot);
      setPreviews((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setPendingRemoveId(undefined);
      setNotice('Avatar retiré de ce projet.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }, [pendingRemoveId]);

  const handleUseInFlow = useCallback(async (id: string) => {
    const api = window.electronAPI?.avatarBible;
    if (!api || !onUseAsset) return;
    setBusy(id);
    setError(undefined);
    try {
      const result = await api.materializeForFlow({ id });
      if (!result.ok || !result.id || !result.name || !result.path || !result.url) {
        throw new Error(result.error ?? 'Préparation de la référence impossible.');
      }
      onUseAsset({ id: result.id, name: result.name, path: result.path, url: result.url });
      setNotice('Copie de travail ajoutée aux ingrédients Flow. La Bible privée reste isolée.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }, [onUseAsset]);

  const avatars = snapshot?.avatars ?? [];

  return (
    <section
      className="rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 via-surface to-violet-500/5 p-4 shadow-sm"
      aria-labelledby="avatar-bible-title"
      data-testid="avatar-bible-panel"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            Identité visuelle privée · projet actif
          </p>
          <h4 id="avatar-bible-title" className="mt-1 flex items-center gap-2 text-sm font-semibold">
            <UserRound className="h-4 w-4 text-cyan-600" aria-hidden="true" />
            Avatars Code Buddy
          </h4>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
            Réunis les vues maîtres, profils, expressions et costumes qui guideront les recettes
            image et vidéo. Les fichiers sont copiés dans le projet ; aucun enrôlement facial ni
            embedding biométrique n’est utilisé.
          </p>
        </div>
        <button
          type="button"
          onClick={startImport}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-[10px] font-semibold text-white hover:bg-cyan-500"
          data-testid="avatar-bible-import-open"
        >
          <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" /> Importer une référence
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1">
          <ShieldCheck className="h-3 w-3 text-emerald-600" aria-hidden="true" /> Stockage local au projet
        </span>
        <span>{avatars.length}/128 références</span>
        <span>PNG · JPEG · WebP · 15 Mo max.</span>
      </div>

      {formOpen ? (
        <AvatarMetadataForm
          draft={draft}
          editing={Boolean(editingId)}
          busy={Boolean(busy)}
          onChange={setDraft}
          onCancel={closeForm}
          onSubmit={() => void submit()}
        />
      ) : null}

      {error ? <div role="alert" className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-700 dark:text-rose-300">{error}</div> : null}
      {notice ? <div role="status" className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[10px] text-cyan-800 dark:text-cyan-200">{notice}</div> : null}

      {busy === 'list' && !snapshot ? (
        <div className="mt-3 rounded-xl border border-dashed border-border p-8 text-center text-[10px] text-muted-foreground">
          Lecture de la Bible privée…
        </div>
      ) : null}

      {snapshot && avatars.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-cyan-500/30 bg-background/60 p-7 text-center" data-testid="avatar-bible-empty">
          <Sparkles className="mx-auto h-5 w-5 text-cyan-500" aria-hidden="true" />
          <p className="mt-2 text-xs font-medium">Crée la mémoire visuelle de Code Buddy</p>
          <p className="mx-auto mt-1 max-w-xl text-[10px] leading-relaxed text-muted-foreground">
            Commence par une vue maître nette, puis ajoute des angles et expressions. Flow pourra
            les employer comme personnages cohérents sans toucher aux données biométriques.
          </p>
        </div>
      ) : null}

      {avatars.length > 0 ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="avatar-bible-grid">
          {avatars.map((avatar) => {
            const isMaster = snapshot?.masterId === avatar.id;
            return (
              <article key={avatar.id} className="overflow-hidden rounded-xl border border-border bg-background/85 shadow-sm">
                <div className="relative aspect-[4/3] bg-slate-950">
                  {previews[avatar.id] ? (
                    <img className="h-full w-full object-cover" src={previews[avatar.id]} alt={`Référence avatar ${avatar.name}`} />
                  ) : (
                    <div className="flex h-full items-center justify-center px-4 text-center text-[10px] text-slate-400">Aperçu différé pour préserver la mémoire</div>
                  )}
                  {isMaster ? (
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-1 text-[9px] font-bold text-amber-950" data-testid={`avatar-master-${avatar.id}`}>
                      <Crown className="h-3 w-3" aria-hidden="true" /> Maître
                    </span>
                  ) : null}
                </div>
                <div className="space-y-2 p-3">
                  <div>
                    <p className="truncate text-xs font-semibold">{avatar.name}</p>
                    <p className="text-[9px] text-muted-foreground">{ROLE_LABELS[avatar.role]} · {avatar.width}×{avatar.height}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[8px] text-emerald-700 dark:text-emerald-300">
                      {RIGHTS_LABELS[avatar.rights]}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[8px] text-muted-foreground">
                      {avatar.consent === 'confirmed' ? 'Consentement confirmé' : 'Consentement N/A'}
                    </span>
                  </div>
                  {avatar.notes ? <p className="line-clamp-2 text-[9px] leading-relaxed text-muted-foreground">{avatar.notes}</p> : null}
                  <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
                    {onUseAsset ? (
                      <button type="button" onClick={() => void handleUseInFlow(avatar.id)} disabled={busy === avatar.id} className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[9px] font-semibold text-white hover:bg-violet-500 disabled:opacity-40" aria-label={`Utiliser ${avatar.name} dans Flow`}>
                        <Sparkles className="h-3 w-3" aria-hidden="true" /> Utiliser dans Flow
                      </button>
                    ) : null}
                    {!isMaster ? (
                      <button type="button" onClick={() => void setMaster(avatar.id)} disabled={busy === avatar.id} className="rounded-md border border-border px-2 py-1 text-[9px] hover:bg-accent" aria-label={`Définir ${avatar.name} comme avatar maître`}>
                        Maître
                      </button>
                    ) : null}
                    <button type="button" onClick={() => startEdit(avatar)} className="rounded-md border border-border p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Modifier ${avatar.name}`}>
                      <Pencil className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => void remove(avatar.id)} disabled={busy === avatar.id} className={`inline-flex items-center gap-1 rounded-md border p-1 text-[9px] ${pendingRemoveId === avatar.id ? 'border-rose-500/40 bg-rose-500/10 px-2 text-rose-700 dark:text-rose-300' : 'border-border text-muted-foreground hover:text-rose-600'}`} aria-label={pendingRemoveId === avatar.id ? `Confirmer la suppression de ${avatar.name}` : `Supprimer ${avatar.name}`}>
                      {pendingRemoveId === avatar.id ? <><Check className="h-3 w-3" aria-hidden="true" /> Confirmer</> : <Trash2 className="h-3 w-3" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/** Keep full-resolution IPC previews under a strict aggregate source budget. */
export function selectPreviewAvatars(snapshot: AvatarBibleSnapshot): AvatarBibleEntry[] {
  const ordered = snapshot.masterId
    ? [
        ...snapshot.avatars.filter((avatar) => avatar.id === snapshot.masterId),
        ...snapshot.avatars.filter((avatar) => avatar.id !== snapshot.masterId),
      ]
    : snapshot.avatars;
  const selected: AvatarBibleEntry[] = [];
  let bytes = 0;
  for (const avatar of ordered) {
    if (selected.length >= MAX_EAGER_PREVIEWS) break;
    if (bytes + avatar.bytes > MAX_EAGER_PREVIEW_SOURCE_BYTES) continue;
    selected.push(avatar);
    bytes += avatar.bytes;
  }
  return selected;
}

function AvatarMetadataForm({
  draft,
  editing,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: AvatarBibleMetadataInput;
  editing: boolean;
  busy: boolean;
  onChange: (draft: AvatarBibleMetadataInput) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const update = <K extends keyof AvatarBibleMetadataInput>(key: K, value: AvatarBibleMetadataInput[K]) => {
    onChange({ ...draft, [key]: value });
  };
  return (
    <form className="mt-3 grid gap-2 rounded-xl border border-cyan-500/25 bg-background/90 p-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(event) => { event.preventDefault(); onSubmit(); }} data-testid="avatar-bible-form">
      <label className="text-[9px] font-medium lg:col-span-2">
        Nom
        <input autoFocus value={draft.name} onChange={(event) => update('name', event.target.value)} maxLength={120} required className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[10px] outline-none focus:border-cyan-500" placeholder="Ex. Code Buddy — tenue principale" />
      </label>
      <label className="text-[9px] font-medium">
        Rôle
        <select value={draft.role} onChange={(event) => update('role', event.target.value as AvatarBibleRole)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[10px]">
          {(Object.keys(ROLE_LABELS) as AvatarBibleRole[]).map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
        </select>
      </label>
      <label className="text-[9px] font-medium">
        Droits
        <select value={draft.rights} onChange={(event) => update('rights', event.target.value as AvatarBibleRights)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[10px]">
          {(Object.keys(RIGHTS_LABELS) as AvatarBibleRights[]).map((rights) => <option key={rights} value={rights}>{RIGHTS_LABELS[rights]}</option>)}
        </select>
      </label>
      <label className="text-[9px] font-medium">
        Consentement
        <select value={draft.consent} onChange={(event) => update('consent', event.target.value as AvatarBibleConsent)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[10px]">
          <option value="not-applicable">Non applicable</option>
          <option value="confirmed">Confirmé</option>
        </select>
      </label>
      <label className="text-[9px] font-medium sm:col-span-2 lg:col-span-4">
        Notes visuelles
        <input value={draft.notes ?? ''} onChange={(event) => update('notes', event.target.value)} maxLength={2000} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[10px] outline-none focus:border-cyan-500" placeholder="Palette, accessoires, détails immuables…" />
      </label>
      <div className="flex items-end justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground" aria-label="Annuler l’édition de l’avatar"><X className="h-3 w-3" /></button>
        <button type="submit" disabled={busy || !draft.name.trim()} className="rounded-md bg-cyan-600 px-3 py-1.5 text-[9px] font-semibold text-white hover:bg-cyan-500 disabled:opacity-40">
          {editing ? 'Enregistrer' : 'Choisir l’image'}
        </button>
      </div>
    </form>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
