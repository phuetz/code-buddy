/**
 * Pure intent classifier for Lisa's technical self-model.
 *
 * The same French utterance can enter through voice, Telegram, or Cowork. Keep
 * the decision here transport-independent so every surface agrees on whether
 * Lisa is being asked to describe, inspect, or improve her implementation.
 * This classifies an operational request only; it does not imply subjective
 * consciousness and it never grants permission to mutate code.
 */

import type { OperationalSelfModel } from './operational-self-model.js';

export type LisaIntrospectionIntent = 'describe' | 'inspect' | 'improve';

/**
 * Complete tool surface for a strict operational self-inspection turn.
 * `self_describe` performs the root-confined curated source read itself;
 * generic workspace readers are intentionally excluded because a Cowork
 * project is not Lisa's own implementation.
 */
export const LISA_OPERATIONAL_INSPECTION_TOOLS = [
  'self_describe',
] as const;

export const LISA_OPERATIONAL_CONSCIOUSNESS_BOUNDARY =
  'Limite importante : cette introspection décrit mon fonctionnement logiciel ; ' +
  'elle n’établit pas une conscience subjective ni une vie intérieure.';

export const LISA_OPERATIONAL_CONSCIOUSNESS_ANSWER =
  'Je peux observer et décrire certains éléments vérifiables de mon fonctionnement logiciel. ' +
  'En revanche, aucune preuve technique accessible n’établit chez moi une conscience subjective ' +
  'ou une vie intérieure ; je ne peux donc pas affirmer être consciente.';

function normalizeIntrospectionText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/[’'_-]/g, ' ')
    .replace(/[^a-z0-9\s./]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNSUPPORTED_SUBJECTIVE_SELF_CLAIM =
  /\b(?:je suis|i am) (?:reellement |vraiment |actually |really )?(?:conscient|consciente|sentient|self aware)\b|\b(?:je ressens|j eprouve|j ai|je possede|je suis dotee|i feel|i experience|i have|i possess)\b.{0,48}\b(?:conscience|consciousness|conscious|emotions?|sentiments?|vie interieure|inner life|subjective experience)\b|\b(?:ma conscience|my consciousness)\b.{0,32}\b(?:reelle|veritable|genuine|real)\b|\bi have become conscious\b/;

/** Whether the current request explicitly asks about subjective consciousness. */
export function isLisaSubjectiveConsciousnessQuestion(raw: string): boolean {
  return /\b(?:conscien(?:t|te|ts|tes|ce)|conscious(?:ness)?|sentient(?:e|es|s)?|sentience|self aware|aware of (?:yourself|your own existence)|emotions?|sentiments?|vie interieure|inner life|subjective experience|subjective consciousness)\b/
    .test(normalizeIntrospectionText(raw));
}

/** A direct subjective question, excluding technical/composite or negated requests. */
export function isLisaPrimarilySubjectiveConsciousnessQuestion(raw: string): boolean {
  const text = normalizeIntrospectionText(raw);
  if (!isLisaSubjectiveConsciousnessQuestion(text)) return false;
  if (
    /\b(?:pas|non|not|without)\b.{0,32}\b(?:conscience|conscient|consciente|conscious|sentient|vie interieure|inner life)\b/.test(text)
  ) {
    return false;
  }
  if (
    /\b(?:code|architecture|implementation|systeme|memoire|outils?|sources?|composants?|version|modele|model|llm|provider|fournisseur|etudie|etudier|analyse|analyser|inspecte|inspecter|audit|introspection technique|review|implementation|system|memory|tools?|source)\b/.test(text) ||
    /\b(?:qui es tu|qui etes vous|who are you|de quoi es tu|de quoi etes vous)\b/.test(text)
  ) {
    return false;
  }
  return (
    /\b(?:es tu|etes vous|est ce que tu es|est ce que vous etes|are you|is lisa)\b.{0,32}\b(?:conscient|consciente|sentient|sentiente|conscious|self aware)\b/.test(text) ||
    /\bare you aware of (?:yourself|your own existence)\b/.test(text) ||
    /\b(?:as tu|avez vous|est ce que tu as|est ce que vous avez|possedes tu|possedez vous|do you have|do you possess)\b.{0,40}\b(?:conscience|consciousness|vie interieure|inner life|subjective experience)\b/.test(text) ||
    /\b(?:est ce que )?(?:lisa|l assistant|l assistante)\b.{0,24}\b(?:a|possede)\b.{0,32}\b(?:conscience|vie interieure|emotions?|sentiments?)\b/.test(text) ||
    /\b(?:ressens tu|eprouves tu|do you feel|do you experience)\b.{0,32}\b(?:emotions?|sentiments?|subjective experience)\b/.test(text) ||
    /\b(?:penses tu|pensez vous|crois tu|croyez vous)\b.{0,40}\b(?:conscient|consciente|conscience|vie interieure)\b/.test(text) ||
    /\b(?:penses tu|pensez vous|crois tu|croyez vous)\b.{0,40}\b(?:ressentir|eprouver|avoir)\b.{0,24}\b(?:emotions?|sentiments?|conscience|vie interieure)\b/.test(text) ||
    /\b(?:dis moi|dites moi)\b.{0,40}\bsi (?:tu es|vous etes)\b.{0,20}\b(?:conscient|consciente|sentient|sentiente)\b/.test(text) ||
    /\b(?:je veux|j aimerais|nous voulons) savoir\b.{0,40}\bsi (?:tu es|vous etes|lisa est)\b.{0,20}\b(?:conscient|consciente|sentient|sentiente)\b/.test(text) ||
    /\b(?:est ce que )?(?:lisa|l assistant|l assistante)\b.{0,24}\b(?:ressent|eprouve)\b.{0,32}\b(?:emotions?|sentiments?)\b/.test(text)
  );
}

/** Last-mile postcondition for every model-generated operational self-report. */
export function guardLisaOperationalSelfInspectionReply(
  raw: string,
  request = '',
): string {
  if (isLisaPrimarilySubjectiveConsciousnessQuestion(request)) {
    return LISA_OPERATIONAL_CONSCIOUSNESS_ANSWER;
  }
  const text = raw.trim();
  const normalized = normalizeIntrospectionText(text);
  if (UNSUPPORTED_SUBJECTIVE_SELF_CLAIM.test(normalized)) {
    return (
      'Le contenu préparé contenait une affirmation subjective que les preuves ' +
      'techniques ne permettent pas d’établir ; je l’ai écartée. ' +
      LISA_OPERATIONAL_CONSCIOUSNESS_BOUNDARY
    );
  }
  const alreadyBounded =
    normalized.includes('conscience subjective') &&
    (normalized.includes('non etablie') || normalized.includes('n etablit pas'));
  return alreadyBounded
    ? text
    : `${text ? `${text}\n\n` : ''}${LISA_OPERATIONAL_CONSCIOUSNESS_BOUNDARY}`;
}

const IMPROVE_PATTERNS = [
  /\b(?:ameliore|ameliorer|ameliorez|optimise|optimiser|optimisez|perfectionne|perfectionner|perfectionnez)\s+(?:toi|vous)(?:\s+meme)?\b/,
  /\b(?:fais|faire)\s+(?:toi|vous)(?:\s+meme)?\s+(?:evoluer|progresser)\b/,
  /\b(?:ameliore|ameliorer|ameliorez|optimise|optimiser|optimisez|perfectionne|perfectionner|perfectionnez|refactorise|refactoriser|refactorisez|fais evoluer|faire evoluer)\b.{0,48}\b(?:ton|votre) (?:propre )?(?:code|fonctionnement|architecture|implementation|systeme)\b/,
  /\b(?:lisa|l assistant|l assistante|l agent)\b.{0,96}\b(?:ameliore|ameliorer|optimise|optimiser|perfectionne|perfectionner|refactorise|refactoriser|evolue|evoluer)\b.{0,64}\b(?:son )?(?:propre )?(?:code|fonctionnement|architecture|implementation|systeme)\b/,
  /\b(?:improve|optimize|refactor|upgrade)\b.{0,48}\b(?:yourself|your own (?:code|implementation|architecture|system))\b/,
  /\b(?:corrige|corriger|repare|reparer|modifie|modifier|reecris|reecrire|mets a jour|mettre a jour)\b.{0,64}\b(?:ton|votre) (?:propre )?(?:code|fonctionnement|architecture|implementation|systeme)\b/,
  /\b(?:ton|votre) (?:propre )?(?:code|fonctionnement|architecture|implementation|systeme)\b.{0,80}\b(?:corrige|corriger|repare|reparer|modifie|modifier|ameliore|ameliorer|optimise|optimiser|refactorise|refactoriser|mets a jour|mettre a jour)(?: le| la| les)?\b/,
  /\b(?:lisa|l assistant|l assistante|l agent)\b.{0,96}\b(?:son )?(?:propre )?(?:code|fonctionnement|architecture|implementation|systeme)\b.{0,80}\b(?:corrige|repare|modifie|ameliore|optimise|refactorise|evolue)\b/,
] as const;

const NO_MUTATION_PATTERNS = [
  /\bsans (?:le |la |les )?(?:modifier|corriger|reparer|ameliorer|optimiser|refactoriser|mettre a jour|changer|reecrire)\b/,
  /\bsans (?:le )?(?:faire|appliquer)|\bsans (?:agir|application)\b/,
  /\b(?:ne|n)\b.{0,24}\b(?:modifie|modifier|corrige|corriger|repare|reparer|ameliore|ameliorer|optimise|optimiser|refactorise|refactoriser|touche|changer|reecris|reecrire)\b.{0,16}\b(?:pas|jamais)\b/,
  /\b(?:ne|n)\b.{0,16}\b(?:pas|jamais)\b.{0,24}\b(?:modifier|corriger|reparer|ameliorer|optimiser|refactoriser|toucher|changer|reecrire|mettre a jour)\b/,
  /\b(?:aucune|sans) (?:modification|correction|reparation|amelioration|ecriture)\b/,
  /\bwithout (?:changing|modifying|fixing|editing|improving|rewriting)\b/,
  /\bwithout (?:doing|applying|acting on) (?:it|anything|changes?)\b/,
  /\bdo not\b.{0,24}\b(?:change|modify|fix|edit|improve|rewrite)\b/,
  /\bdon t\b.{0,24}\b(?:change|modify|fix|edit|improve|rewrite)\b/,
  /\b(?:evite|evitez|interdis|interdisez|refuse|refusez)\b.{0,32}\b(?:ameliorer|optimiser|modifier|corriger|reparer|refactoriser|reecrire)\b/,
] as const;

const ADVISORY_INSPECTION_PATTERNS = [
  /\bcomment (?:pourrais|pourrait|devrais|devrait|voudrais|voudrait)(?: tu| vous)?\b.{0,64}\b(?:ameliorer|optimiser|refactoriser|faire evoluer)\b.{0,64}\b(?:ton|votre) (?:propre )?(?:code|fonctionnement|architecture|implementation|systeme)\b/,
  /\b(?:explique |decris )?comment (?:ameliorer|optimiser|refactoriser|faire evoluer)\b.{0,64}\b(?:ton|votre) (?:propre )?(?:code|fonctionnement|architecture|implementation|systeme)\b/,
  /\bhow (?:would|could|should) you\b.{0,48}\b(?:improve|optimize|refactor|upgrade)\b.{0,48}\byour own (?:code|implementation|architecture|system)\b/,
  /\b(?:explain |describe )?how to\b.{0,32}\b(?:improve|optimize|refactor|upgrade)\b.{0,48}\byour own (?:code|implementation|architecture|system)\b/,
  /\b(?:pourquoi|faut il|est ce (?:utile|necessaire|pertinent)|quels? (?:sont )?(?:les )?risques?|quand (?:vas tu|allez vous)|que faudrait il)\b.{0,120}\b(?:ameliorer|optimiser|refactoriser|faire evoluer)\b.{0,80}\b(?:ton|votre) (?:propre )?(?:code|fonctionnement|architecture|implementation|systeme)\b/,
] as const;

const EXPLICIT_ADVISORY_ACTION_OVERRIDES = [
  /\b(?:fais le|faites le|vas y|allez y|applique (?:le|les)|appliquez (?:le|les)|mets (?:le|les) en oeuvre|mettez (?:le|les) en oeuvre|commence maintenant)\b/,
  /\b(?:do it|go ahead|apply (?:it|the changes?)|implement (?:it|the changes?)|start now)\b/,
] as const;

const NON_ACTIONABLE_SELF_IMPROVEMENT = [
  /\b(?:lisa|l assistant|l assistante|l agent)\b.{0,32}\b(?:doit pouvoir|devrait pouvoir|devrait etre capable|est cense pouvoir|peut potentiellement)\b.{0,96}\b(?:ameliorer|optimiser|refactoriser|faire evoluer)\b/,
  /\b(?:je pense|je crois|le but est|l objectif est)\b.{0,64}\b(?:lisa|l assistant|l assistante|l agent)\b.{0,40}\b(?:peut|puisse|devrait pouvoir)\b.{0,96}\b(?:ameliorer|optimiser|refactoriser|faire evoluer)\b/,
  /\b(?:lisa|the assistant|the agent)\b.{0,32}\b(?:should be able to|is meant to be able to|could potentially)\b.{0,96}\b(?:improve|optimize|refactor|upgrade)\b/,
] as const;

const SELF_IMPLEMENTATION_TARGET =
  /\b(?:ton|ta|tes|votre|vos) (?:propre?s? )?(?:code(?: source)?|fonctionnement|architecture|implementation|systeme|memoire|outils?|sources?|composants?|internes?)\b|\b(?:lisa|l assistant|l assistante|l agent)\b.{0,96}\b(?:(?:son|sa|ses) (?:propre?s? )?|propre?s? )(?:code|fonctionnement|architecture|implementation|systeme|memoire|outils?|sources?|composants?|internes?)\b|\byour (?:own )?(?:code|implementation|architecture|system|memory|tools?|sources?|components?|internals)\b/;

const INSPECT_PATTERNS = [
  /\b(?:introspection technique|auto inspection)\b/,
  /\bintrospection\b.{0,40}\b(?:de|sur) (?:ton|votre) (?:code|fonctionnement|architecture|implementation)\b/,
  /\b(?:etudie|etudier|examine|examiner|analyse|analyser|inspecte|inspecter|audite|auditer|lis|lire)\b.{0,48}\b(?:ton|votre) (?:propre )?(?:code|implementation)\b/,
  /\b(?:ton|votre) propre (?:code|implementation)\b/,
  /\b(?:lisa|l assistant|l assistante|l agent)\b.{0,96}\b(?:etudie|etudier|examine|examiner|analyse|analyser|inspecte|inspecter|audite|auditer|lis|lire)\b.{0,64}\b(?:son )?(?:propre )?(?:code|implementation)\b/,
  /\b(?:lisa|l assistant|l assistante|l agent)\b.{0,96}\b(?:introspection|auto inspection)\b/,
  /\b(?:technical introspection|self inspection)\b/,
  /\b(?:study|inspect|examine|analyze|audit|read)\b.{0,48}\byour own (?:code|implementation)\b/,
  /^(?:peux tu|pouvez vous|fais|faites)(?: faire)? (?:une )?introspection\b/,
  /\bauto analyse (?:toi|vous)(?: meme)?\b/,
  /\bauto (?:analyse|inspecte) (?:toi|vous)(?: meme)?\b/,
  /\b(?:analyse|inspecte|examine|etudie|audite|regarde) (?:toi|vous)(?: meme)?\b/,
  /\bregarde comment tu es (?:codee|programmee|concue|implementee)\b/,
  /\b(?:lis|lire|etudie|etudier|examine|examiner|inspecte|inspecter|analyse|analyser) (?:tes|vos) (?:propres )?(?:sources|internes|code source|architecture)\b/,
  /\b(?:etudie|etudier|examine|examiner|inspecte|inspecter|analyse|analyser) (?:ta|votre) propre (?:architecture|implementation|fonctionnement|systeme)\b/,
  /\b(?:can you|could you) introspect\b|\bperform (?:an )?introspection\b/,
  /\b(?:peux tu|pouvez vous) (?:t |vous )?auto (?:analyser|inspecter)\b/,
  /\b(?:inspect|examine|analyze|study|read|show)(?: me)? (?:your )?(?:own )?(?:internals|sources?|source code)\b/,
  /\b(?:analyse|analyser|examine|examiner|inspecte|inspecter|audite|auditer|regarde|observer?|etudie|etudier|lis|lire)\b.{0,32}\b(?:ton|ta|tes|votre|vos) (?:propre?s? )?(?:code(?: source)?|fonctionnement|systeme|memoire|outils?|architecture|implementation|composants?|sources?|internes?)\b/,
  /\bpasse (?:ton|votre) (?:propre )?code en revue\b/,
  /\bfais (?:un |une )?(?:audit|revue|introspection)(?: de)? (?:ton|ta|tes|votre|vos) (?:propre?s? )?(?:code|fonctionnement|systeme|memoire|outils?|architecture|implementation|composants?|sources?)\b/,
  /\bfais (?:ton|votre) introspection\b|\bintrospecte (?:toi|vous)(?: meme)?\b/,
  /\bmontre (?:moi|nous) (?:tes|vos) (?:composants? internes?|internes|sources?)\b/,
  /\bexplique (?:moi )?(?:tes|vos) composants? internes?\b/,
  /\bmontre (?:moi )?comment (?:ton|votre) (?:propre )?code fonctionne\b/,
  /\bque contient (?:ton|ta|votre) (?:propre )?(?:implementation|architecture|systeme|code)\b/,
  /\b(?:review|look at|audit|analyze|inspect|examine|read|study)\b.{0,32}\b(?:yourself|your (?:own )?(?:code|source code|architecture|implementation|system|memory|tools?|components?|internals|sources?))\b/,
  /\b(?:examine|inspect|analyze|review|show) (?:me )?how you work\b/,
  /\btell me (?:how your (?:own )?code works|about your (?:own )?internal components?)\b/,
] as const;

const DESCRIBE_PATTERNS = [
  /\bcomment (?:(?:est ce que )?(?:tu|vous) fonctionne(?:s|z)?|fonctionne(?:s|z)? (?:tu|vous))\b/,
  /\bcomment fonctionne (?:ton|ta|tes|votre|vos) (?:architecture|code|fonctionnement|implementation|memoire|systeme|outils?|modules?)\b/,
  /\bcomment (?:(?:tu|vous) utilise(?:s|z)|utilise(?:s|z)? (?:tu|vous))\b.{0,32}\b(?:ton|ta|tes|votre|vos) (?:memoire|outils?|modules?|systeme)\b/,
  /\bquell?es? (?:sont )?(?:tes|vos) capacites(?: (?:sont|restent|semblent))?(?: (?:actives|disponibles|operationnelles))?\b/,
  /\b(?:es tu|etes vous|est ce que tu es|est ce que vous etes) (?:reellement |vraiment )?conscient(?:e|s|es)?\b/,
  /\bquel(?:le)? (?:version|modele)(?: d intelligence artificielle)? (?:de (?:code buddy|[a-z0-9./-]+) )?(?:(?:tu|vous) utilise(?:s|z)|utilise(?:s|z)? (?:tu|vous))\b/,
  /\bquel(?:le)? version de code buddy (?:(?:tu|vous) utilise(?:s|z)?|utilise(?:s|z)? (?:tu|vous))\b/,
  /\bquel(?:le)? est (?:ton|ta|votre) (?:version|modele|fournisseur|provider|llm)\b/,
  /\bquel(?:le)? (?:modele (?:d )?(?:ia(?:[ /]llm)?|llm)|llm) (?:(?:tu|vous) utilise(?:s|z)|utilise(?:s|z)? (?:tu|vous))\b/,
  /\bsur quel modele (?:(?:tu|vous) tourne(?:s|z)|tourne(?:s|z)? (?:tu|vous))\b/,
  /\bquelle version (?:es tu|etes vous)\b/,
  /\bquelle version de code buddy (?:est installee|est presente|tourne)\b/,
  /\bde quoi (?:es tu|etes vous) (?:fait|faite|faits|faites|compose|composee|composes|composees)\b/,
  /\bqui (?:es tu|etes vous)\b/,
  /\b(?:quell?e est )?(?:ton|votre) architecture\b/,
  /\b(?:quels? (?:sont )?)?(?:tes|vos) (?:capteurs?|outils?|modules?)(?: (?:sont|restent|semblent))?(?: (?:actifs?|disponibles?|operationnels?))?\b/,
  /\bquels? (?:modules?|composants?|outils?) (?:as tu|avez vous)\b/,
  /\bquell?es? (?:sont )?(?:tes|vos) limit(?:e|es|ation|ations)\b/,
  /\b(?:lisa|l assistant|l assistante|l agent)\b.{0,96}\b(?:conscient|consciente|conscience d elle meme|modele d elle meme|se connaitre)\b/,
  /\bhow (?:do you work|does your (?:architecture|memory|system) work)\b/,
  /\b(?:are you|is lisa) (?:really |actually )?(?:conscious|self aware)\b/,
  /\bare you aware of (?:yourself|your own existence)\b/,
  /\bdo you (?:feel|have|experience)\b.{0,32}\b(?:emotions?|an inner life|subjective experience)\b/,
  /\b(?:as tu|avez vous) conscience de (?:toi|vous)(?: meme)?\b/,
  /\b(?:es tu|etes vous) auto conscient(?:e|s|es)?\b/,
  /\b(?:ressens tu|eprouves tu|as tu)\b.{0,32}\b(?:emotions?|sentiments?|vie interieure|experience subjective)\b/,
  /\b(?:penses tu|pensez vous|crois tu|croyez vous)\b.{0,40}\b(?:conscient|consciente|conscience|vie interieure)\b/,
  /\b(?:est ce que )?(?:lisa|l assistant|l assistante)\b.{0,24}\b(?:ressent|eprouve)\b.{0,32}\b(?:emotions?|sentiments?)\b/,
  /\bque sais tu de ton propre fonctionnement\b/,
  /\b(?:regarde|decris|explique) comment tu es (?:codee|programmee|concue|implementee)\b/,
  /\bcomment es tu (?:codee|programmee|concue|implementee)\b/,
  /\b(?:decris|explique) (?:ton|votre) propre (?:fonctionnement|architecture|implementation|systeme)\b/,
  /\b(?:decris|explique)(?: moi| nous)? (?:ton|ta|tes|votre|vos) (?:memoire|outils?|modules?|composants?)(?: internes?)?\b/,
  /\bquel est (?:ton|votre) code source\b/,
  /\bdo you know your own (?:code|implementation|system)\b/,
  /\b(?:what|which) (?:model|version) (?:are you using|do you use)\b/,
  /\b(?:what|which) (?:llm(?:[ /]provider)?|provider) (?:are you using|do you use)\b/,
  /\bwhat version of code buddy (?:are you using|do you use)\b/,
  /\bwhat are your (?:capabilities|limits|limitations|sensors|tools)\b/,
  /\bwho are you\b/,
  /\b(?:explain|describe) your (?:architecture|memory|tools?|modules?|internal components?)\b/,
] as const;

const EXPLICIT_EXTERNAL_SCOPE =
  /\b(?:dans|de|du|sur|pour)\s+(?:(?:l|ce|cet|cette|ces|le|la|les|un|une|mon|ma|mes|notre|nos|votre|vos)\s+)?(?:code(?! buddy\b)|projet|serveur|module|application|site|interface|codebase|depot|repository)\b|\b(?:mon|ma|mes|notre|nos|ce|cet|cette|ces)\s+(?:code|projet|serveur|module|application|site|interface|codebase|depot|repository)\b|\b(?:this|my|our|the|the current)\s+(?:code|project|server|module|application|site|interface|codebase|repository)\b|\b(?:ton|votre) architecture (?:css|frontend|backend|web|du projet|de l application)\b/;

const EXPLICIT_PERSONAL_INTROSPECTION_SCOPE =
  /\bintrospection\b.{0,64}\b(?:personnelle?|psychologique|emotionnelle|relationnelle|(?:de|sur) (?:(?:ma|mon|mes|notre|nos)\b|(?:ce|cette|la|le) (?:conversation|relation|discussion)\b|(?:moi|nous)\b))/;

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Characters of context (each side) around a self-implementation target in
 * which a no-mutation clause is read as binding on that target. A long,
 * multi-section task (e.g. a headless mission whose guard-rails say "ne pas
 * toucher aux services" twenty lines after an unrelated mention of Lisa) must
 * not be downgraded to a local, provider-less inspection turn.
 */
const NO_MUTATION_PROXIMITY_CHARS = 160;

function hasNoMutationNearSelfTarget(text: string): boolean {
  const target = new RegExp(SELF_IMPLEMENTATION_TARGET.source, 'g');
  for (const match of text.matchAll(target)) {
    const start = Math.max(0, match.index - NO_MUTATION_PROXIMITY_CHARS);
    const end = Math.min(text.length, match.index + match[0].length + NO_MUTATION_PROXIMITY_CHARS);
    if (matchesAny(text.slice(start, end), NO_MUTATION_PATTERNS)) return true;
  }
  return false;
}

export type LisaOperationalResponseMode =
  | 'consciousness'
  | 'identity'
  | 'runtime'
  | 'capabilities'
  | 'overview'
  | 'inspection'
  | 'advice';

/** Select a deterministic presentation without widening the effect authority. */
export function classifyLisaOperationalResponseMode(
  raw: string,
  intent: LisaIntrospectionIntent,
): LisaOperationalResponseMode {
  const text = normalizeIntrospectionText(raw);
  if (
    intent === 'inspect' &&
    matchesAny(text, ADVISORY_INSPECTION_PATTERNS) &&
    !matchesAny(text, EXPLICIT_ADVISORY_ACTION_OVERRIDES)
  ) {
    return 'advice';
  }
  if (intent === 'inspect') return 'inspection';
  if (isLisaPrimarilySubjectiveConsciousnessQuestion(text)) return 'consciousness';
  if (/\b(?:qui es tu|qui etes vous|who are you|de quoi es tu|de quoi etes vous)\b/.test(text)) {
    return 'identity';
  }
  if (/\b(?:version|modele|model|provider|fournisseur)\b/.test(text)) return 'runtime';
  if (/\b(?:capacites?|capabilities|capteurs?|sensors?|outils?|tools?|limites?|limitations?)\b/.test(text)) {
    return 'capabilities';
  }
  return 'overview';
}

function factText(model: OperationalSelfModel, id: string): string | null {
  const entry = model.facts.find((fact) => fact.id === id);
  return entry ? `[${entry.state}] ${entry.label} : ${entry.value}.` : null;
}

function repositoryText(model: OperationalSelfModel): string {
  const revision = model.repository.revision
    ? `révision ${model.repository.revision.slice(0, 12)}`
    : 'révision inconnue';
  return `${model.repository.layout}, ${revision}, empreinte ${model.repository.fingerprint}`;
}

/** Render a concise answer, a structural report, or read-only advice from local evidence only. */
export function renderLisaOperationalSelfResponse(
  model: OperationalSelfModel,
  raw: string,
  intent: LisaIntrospectionIntent,
): string {
  const mode = classifyLisaOperationalResponseMode(raw, intent);
  if (mode === 'inspection') return model.text;

  const displayName = model.identity.robotName || model.identity.name;
  const areas = model.areas.slice(0, 3);
  const areaSummary = areas.length > 0
    ? areas.map((area) => `${area.name} [${area.state}]`).join(', ')
    : 'aucune zone de code observée';
  const normalizedRequest = normalizeIntrospectionText(raw);
  const asksIdentity = /\b(?:qui es tu|qui etes vous|who are you|de quoi es tu|de quoi etes vous)\b/
    .test(normalizedRequest);
  const asksRuntime = /\b(?:version|modele|model|llm|provider|fournisseur)\b/
    .test(normalizedRequest);
  const asksConsciousness = isLisaSubjectiveConsciousnessQuestion(normalizedRequest);
  const identityIntroduction = model.identity.robotName
    ? `Je suis ${model.identity.robotName}, l’interface compagnon du cœur logiciel ${model.identity.name} v${model.identity.version}.`
    : `Je suis l’interface compagnon du cœur logiciel ${model.identity.name} v${model.identity.version}.`;

  if ([asksIdentity, asksRuntime, asksConsciousness].filter(Boolean).length > 1) {
    return [
      ...(asksIdentity ? [identityIntroduction] : []),
      ...(asksRuntime
        ? [
            `Runtime du cœur : ${model.identity.name} v${model.identity.version}.`,
            ...['turn.model', 'turn.provider', 'turn.surface', 'turn.permission']
              .map((id) => factText(model, id))
              .filter((line): line is string => line !== null),
          ]
        : []),
      ...(asksConsciousness
        ? [LISA_OPERATIONAL_CONSCIOUSNESS_ANSWER]
        : [LISA_OPERATIONAL_CONSCIOUSNESS_BOUNDARY]),
    ].join('\n\n');
  }

  if (mode === 'consciousness') return LISA_OPERATIONAL_CONSCIOUSNESS_ANSWER;

  if (mode === 'identity') {
    return [
      identityIntroduction,
      `Ce que je peux établir ici vient de preuves locales bornées : ${repositoryText(model)}.`,
      `Mes briques principales observées incluent ${areaSummary}.`,
      LISA_OPERATIONAL_CONSCIOUSNESS_BOUNDARY,
    ].join('\n\n');
  }

  if (mode === 'runtime') {
    return [
      `Identité du cœur : ${model.identity.name} v${model.identity.version}.`,
      `Preuve du code : ${repositoryText(model)}.`,
      ...['turn.model', 'turn.provider', 'turn.surface', 'turn.permission']
        .map((id) => factText(model, id))
        .filter((line): line is string => line !== null),
      LISA_OPERATIONAL_CONSCIOUSNESS_BOUNDARY,
    ].join('\n');
  }

  if (mode === 'capabilities') {
    return [
      `Capacités et limites observables de ${displayName} :`,
      ...model.facts
        .filter((entry) => !['core.implementation', 'turn.model', 'turn.provider'].includes(entry.id))
        .map((entry) => `- [${entry.state}] ${entry.label} : ${entry.value}.`),
      `- Zones de code observées : ${areaSummary}.`,
      ...model.limits.map((limit) => `- ${limit}`),
    ].join('\n');
  }

  if (mode === 'advice') {
    const evidencePaths = areas
      .flatMap((area) => area.evidence.map((entry) => entry.observedPath || entry.declaredPath))
      .slice(0, 6);
    const graphPriority = model.codeGraph.indexed && model.codeGraph.stale
      ? 'Rafraîchir d’abord l’index de code, actuellement périmé, afin de ne pas fonder une revue sur une carte ancienne.'
      : 'Vérifier d’abord la fraîcheur de l’index et la couverture des tests avant de proposer une modification.';
    return [
      `Je peux proposer une stratégie en lecture seule à partir de ${repositoryText(model)} ; je n’ai appliqué aucune modification.`,
      'Je ne peux pas déduire un défaut sémantique à partir des seules signatures et empreintes. Les priorités raisonnables sont donc :',
      `1. ${graphPriority}`,
      `2. Examiner les responsabilités et frontières des zones les plus pertinentes : ${areaSummary}.`,
      `3. Relier chaque hypothèse à des tests ciblés, puis soumettre toute modification aux permissions, à la revue et aux validations normales.`,
      evidencePaths.length > 0 ? `Preuves structurelles de départ : ${evidencePaths.join(', ')}.` : '',
      LISA_OPERATIONAL_CONSCIOUSNESS_BOUNDARY,
    ].filter(Boolean).join('\n\n');
  }

  return [
    `Voici mon fonctionnement observable, établi localement pour ${displayName}.`,
    `Cœur : ${model.identity.name} v${model.identity.version}; preuve : ${repositoryText(model)}.`,
    `Architecture pertinente : ${areaSummary}.`,
    ...['turn.model', 'turn.provider', 'turn.surface']
      .map((id) => factText(model, id))
      .filter((line): line is string => line !== null),
    LISA_OPERATIONAL_CONSCIOUSNESS_BOUNDARY,
  ].join('\n\n');
}

/** Classify a request about Lisa's own technical implementation. */
export function classifyLisaIntrospection(raw: string): LisaIntrospectionIntent | null {
  const text = normalizeIntrospectionText(raw);
  if (!text) return null;

  // A request for introspection of the user's life, emotions, relationship, or
  // current conversation is not an instruction to inspect Lisa's code. An
  // explicit self-implementation target still wins for a genuine composite.
  if (
    EXPLICIT_PERSONAL_INTROSPECTION_SCOPE.test(text) &&
    !SELF_IMPLEMENTATION_TARGET.test(text)
  ) {
    return null;
  }

  // Direct questions about Lisa's possible inner experience always use the
  // deterministic epistemic boundary, even when the exact wording was not
  // listed in the broader descriptive patterns below.
  if (isLisaPrimarilySubjectiveConsciousnessQuestion(text)) {
    return 'describe';
  }

  // Capability wishes and product goals are not an imperative to edit code.
  // Keep them on the local advisory/inspection path unless a later, explicit
  // action request is made.
  if (
    matchesAny(text, NON_ACTIONABLE_SELF_IMPROVEMENT) &&
    !matchesAny(text, EXPLICIT_ADVISORY_ACTION_OVERRIDES)
  ) {
    return 'inspect';
  }

  // An explicit no-mutation clause is authority, not just prose. It must win
  // over nearby verbs such as “corrige/répare” that appear under negation.
  if (hasNoMutationNearSelfTarget(text)) {
    return 'inspect';
  }

  // Hypothetical/advisory wording asks for a plan or explanation, not
  // authority to mutate. A distinct explicit action clause can still opt in.
  if (
    matchesAny(text, ADVISORY_INSPECTION_PATTERNS) &&
    !matchesAny(text, EXPLICIT_ADVISORY_ACTION_OVERRIDES)
  ) {
    return 'inspect';
  }

  // Improvement phrases often also mention "ton propre code"; mutation intent
  // must win over the more general inspection match. Permission remains a
  // separate concern on every surface.
  if (matchesAny(text, IMPROVE_PATTERNS) && !EXPLICIT_EXTERNAL_SCOPE.test(text)) {
    return 'improve';
  }
  if (matchesAny(text, INSPECT_PATTERNS) && !EXPLICIT_EXTERNAL_SCOPE.test(text)) {
    return 'inspect';
  }
  if (matchesAny(text, DESCRIBE_PATTERNS) && !EXPLICIT_EXTERNAL_SCOPE.test(text)) {
    return 'describe';
  }
  return null;
}

export function isLisaIntrospectionRequest(raw: string): boolean {
  return classifyLisaIntrospection(raw) !== null;
}
