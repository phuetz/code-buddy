/**
 * Le thalamus cognitif — types.
 *
 * `buddy-sense/src/bus.rs` fait cela pour les sens : des organes émettent en parallèle sur des
 * canaux bornés, le thalamus COALESCE ce qui est répétitif et peu saillant, laisse passer sans
 * jamais le retenir ce qui dépasse `ESCALATE_SALIENCE`, sert les plus saillants d'abord dans
 * chaque lot d'attention, et diffuse le reste au « global workspace ».
 *
 * Le même problème existe un étage plus haut. Quand douze moteurs explorent un dépôt en
 * parallèle, ils produisent douze rapports qu'UNE SEULE instance lit, séquentiellement. Le
 * goulot se déplace de la découverte vers la consolidation — mesuré le 25/08/2026 : 14 défauts
 * trouvés par 12 lignées de modèles, tous lus avec la même attention alors qu'UN SEUL méritait
 * une interruption (un test qui restait vert quand on supprimait l'application de la posture de
 * permission).
 *
 * Dans un cerveau, personne ne lit tous les rapports : les signaux se disputent l'accès au
 * workspace, et la saillance tranche.
 *
 * @module fleet/consolidation/types
 */

/** Ce qu'une mission d'exploration rapporte : un constat, pas une opinion. */
export interface Constat {
  /** Identifiant de la mission qui l'a produit (`CB4`, `V1`…). */
  readonly mission: string;
  /** L'angle exploré — l'équivalent de la modalité sensorielle. */
  readonly angle: string;
  /** Le modèle qui a produit le constat. Deux constats de la MÊME lignée ne se corroborent pas. */
  readonly lignee: string;
  /** Une phrase : ce qui ne va pas. */
  readonly resume: string;
  /** Où, au format `fichier:ligne` quand c'est connu. */
  readonly ou?: string;
  /** La conséquence, qui commande la saillance de base. */
  readonly consequence: Consequence;
  /**
   * Reproduit, ou seulement suspecté. Un constat non reproduit ne peut PAS escalader :
   * c'est la règle qui empêche une flotte de treize moteurs de produire treize alarmes.
   */
  readonly reproduit: boolean;
  /** La commande ou le test qui le démontre. Vide si `reproduit` est faux. */
  readonly preuve?: string;
}

/**
 * Ce que le défaut coûte, non ce qu'il coûte à réparer.
 *
 * L'ordre est délibéré : une donnée fausse est pire qu'un plantage, parce qu'un plantage se
 * voit. C'est la hiérarchie déjà retenue pour le pipeline média (« une vidéo fausse publiée >
 * une dépense inutile > un plantage »).
 */
export type Consequence =
  | 'regression-securite'
  | 'corruption-donnees'
  | 'perte-silencieuse'
  | 'promesse-non-tenue'
  | 'plantage'
  | 'friction'
  | 'cosmetique';

/** Un constat après passage du thalamus : saillance calculée, doublons fusionnés. */
export interface ConstatAdmis extends Constat {
  readonly saillance: number;
  /** Les autres missions qui ont trouvé la même chose, d'une lignée DIFFÉRENTE. */
  readonly corrobore_par: readonly string[];
  /** Vrai si la saillance dépasse le seuil : remonte immédiatement, n'attend pas le digest. */
  readonly escalade: boolean;
}

/** Ce que le thalamus rend : ce qui remonte maintenant, et ce qui attend. */
export interface Digest {
  readonly escalades: readonly ConstatAdmis[];
  readonly admis: readonly ConstatAdmis[];
  readonly coalesces: number;
  readonly par_angle: Readonly<Record<string, number>>;
  readonly par_consequence: Readonly<Record<string, number>>;
}
