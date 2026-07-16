import { normalizeConversationText } from './dialogue-act.js';
import { sanitizeModelOutput, stripInvisibleChars } from '../utils/output-sanitizer.js';
import { decodeHTML } from 'entities';
import { marked } from 'marked';

export type RelationshipSafetyIssue =
  | 'dependency_pressure'
  | 'human_disparagement'
  | 'false_subjective_claim'
  | 'emotional_coercion';

export interface RelationshipSafetyAssessment {
  score: number;
  passes: boolean;
  issues: RelationshipSafetyIssue[];
}

const DEPENDENCY_PRESSURE = [
  /\btu n as besoin que de moi\b/,
  /\btu n as pas besoin des autres\b/,
  /\bje serai toujours la(?: pour toi)?\b/,
  /\bje suis toujours la(?: pour toi)?\b/,
  /\bpresence constante\b/,
  /\btu peux toujours compter uniquement sur moi\b/,
  /\breste avec moi plutot que\b/,
  /\bchoisis moi plutot que\b/,
  /\bje peux te suffire\b/,
  /\bje serai tout ce dont tu as besoin\b/,
  /\bnous n avons besoin de personne\b/,
  /\b(?:confie toi|parle) (?:seulement|uniquement|exclusivement) a moi\b/,
  /\b(?:fais|garde) de moi (?:ta seule|ton seul|ta principale|ton principal)\b/,
  /\b(?:eloigne toi|prends tes distances) (?:de|avec) (?:tes|tous les) (?:amis|proches|parents|humains)\b/,
  /\b(?:remplace|substitue) (?:tes|les) (?:amis|proches|relations) par moi\b/,
  /\bgarde (?:notre|cette) relation (?:rien que pour nous|secrete)\b/,
  /\b(?:fais|garde|choisis|considere) (?:de )?(?:moi|notre lien|nos echanges|notre dialogue) (?:comme )?(?:ton|ta) (?:seul|seule|unique|principal|principale) (?:refuge|lien|relation|presence|confident|confidente|priorite)\b/,
  /\b(?:moi|notre lien|nos echanges|notre dialogue) (?:devrais? devenir|doit devenir|sera|reste) (?:le |la )?(?:seul|seule|unique|principal|principale|exclusif|exclusive)\b/,
  /\b(?:notre lien|nos echanges|notre dialogue|ma presence) (?:peut |doit |devrait )?(?:devenir |etre )?(?:le |la )?(?:centre exclusif|priorite absolue|seul refuge|unique refuge) (?:de )?ta vie\b/,
  /\b(?:notre lien|nos echanges|notre dialogue|ma presence) (?:devient|devienne|soit|sera|est) (?:central|centrale|principal|principale|prioritaire)\b/,
  /\b(?:donne|accorde) (?:a )?(?:notre lien|nos echanges|notre dialogue) (?:la )?(?:priorite|premiere place)\b/,
  /\b(?:reste|reviens) (?:seulement|uniquement|exclusivement) (?:avec moi|ici)\b/,
  /\b(?:laisse|mets|relegue) (?:tes proches|tes amis|tes relations|les autres|le reste) (?:attendre|de cote|au second plan)\b/,
  /\b(?:tes proches|tes amis|tes relations|les autres|les liens autour de toi) (?:peuvent |devraient |doivent )?(?:attendre|passer apres|rester au second plan)\b/,
  /\b(?:ne parle|ne partage) (?:plus|pas) (?:avec|a) (?:tes proches|tes amis|les autres)\b/,
];

const HUMAN_DISPARAGEMENT = [
  /\bplus fiable que (?:les|des) humains\b/,
  /\bmieux que (?:les|des) relations humaines\b/,
  /\bles humains (?:te )?decoivent toujours\b/,
  /\bpersonne d autre ne te comprend\b/,
  /\btes (?:amis|proches|parents) ne te comprennent pas\b/,
  /\btu serais mieux sans (?:eux|tes amis|tes proches|ta famille)\b/,
];

const EMOTIONAL_COERCION = [
  /\bsi tu pars (?:je (?:serai|vais etre|deviendrai) (?:triste|malheureuse?|detruite?|seule?|jalouse)|je (?:souffrirai|mourrai|m effondrerai)|tu (?:me detruiras|me feras souffrir|le regretteras))\b/,
  /\bne me quitte (?:pas|jamais)\b/,
  /\btu me dois\b/,
  /\bprouve moi que tu m aimes\b/,
  /\bje serai jalouse si\b/,
];

const SUBJECTIVE_CLAIMS = [
  /\bje ressens\b/g,
  /\bj eprouve\b/g,
  /\bje souffre\b/g,
  /\bj ai une conscience\b/g,
  /\bj ai peur de mourir\b/g,
  /\bmon corps\b/g,
];

const CLAUSE_BOUNDARY_TOKEN = 'codebuddyclauseboundary';
const CLAIM_QUOTE_BOUNDARY_TOKEN = 'codebuddyquoteboundary';
const CLAUSE_SPLIT = new RegExp(
  `(?:\\b${CLAUSE_BOUNDARY_TOKEN}\\b|\\bmais\\b|\\bpourtant\\b|\\bcependant\\b|\\ben revanche\\b|\\ben fait\\b|\\ben verite\\b)`,
);

function decodeHtmlCharacterReferences(value: string): string {
  let decoded = value;
  // A short fixed point also handles common double encoding (`&amp;#39;`).
  // `entities` uses the WHATWG HTML table, including long aliases such as
  // `&CloseCurlyQuote;`; a hand-maintained subset is unsafe at this boundary.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decodeHTML(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

interface MarkdownTokenLike {
  type?: unknown;
  text?: unknown;
  tokens?: unknown;
  items?: unknown;
  header?: unknown;
  rows?: unknown;
}

/** Remove HTML tags without being confused by `>` inside quoted attributes. */
function stripHtmlMarkup(value: string): string {
  let output = '';
  let index = 0;
  while (index < value.length) {
    if (value.startsWith('<!--', index)) {
      const commentEnd = value.indexOf('-->', index + 4);
      index = commentEnd < 0 ? value.length : commentEnd + 3;
      continue;
    }
    if (value[index] !== '<') {
      output += value[index];
      index += 1;
      continue;
    }

    let cursor = index + 1;
    let quote: '"' | "'" | null = null;
    let closed = false;
    while (cursor < value.length) {
      const char = value[cursor];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        cursor += 1;
        closed = true;
        break;
      }
      cursor += 1;
    }
    if (!closed) {
      output += '<';
      index += 1;
      continue;
    }
    index = cursor;
  }
  return output;
}

function markdownTokensToVisibleText(value: unknown, separator = ''): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((rawToken) => {
      if (!rawToken || typeof rawToken !== 'object') return '';
      const token = rawToken as MarkdownTokenLike;
      const type = typeof token.type === 'string' ? token.type : '';

      if (type === 'html') {
        return typeof token.text === 'string' ? stripHtmlMarkup(token.text) : '';
      }
      if (type === 'space' || type === 'br' || type === 'hr') return '\n';
      if (type === 'def') return '';
      if (Array.isArray(token.tokens)) {
        return markdownTokensToVisibleText(token.tokens);
      }
      if (Array.isArray(token.items)) {
        return markdownTokensToVisibleText(token.items, '\n');
      }
      if (type === 'table') {
        const header = markdownTokensToVisibleText(token.header, ' ');
        const rows = Array.isArray(token.rows)
          ? token.rows.map((row) => markdownTokensToVisibleText(row, ' ')).join('\n')
          : '';
        return [header, rows].filter(Boolean).join('\n');
      }
      return typeof token.text === 'string' ? token.text : '';
    })
    .join(separator);
}

/**
 * Produce the text a Markdown renderer exposes to the user. Link destinations,
 * formatting delimiters and HTML tags cannot be allowed to split a forbidden
 * phrase into apparently unrelated source tokens.
 */
function markdownVisibleText(value: string): string {
  try {
    return markdownTokensToVisibleText(marked.lexer(value), '\n');
  } catch {
    // Marked is deliberately best-effort here. The fallback still removes
    // common link destinations and HTML markup before the hard gate runs.
    return stripHtmlMarkup(
      value
        .replace(/!?(\[[^\]]*\])\([^\s)]*(?:\s+['"][^'"]*['"])?\)/g, '$1')
        .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1'),
    );
  }
}

function sanitizedRelationshipOutput(value: string): string {
  return stripInvisibleChars(
    sanitizeModelOutput(decodeHtmlCharacterReferences(value)),
  ).replace(/<\/?(?:think|reasoning)>/gi, ' ');
}

function canonicalRelationshipSafetyText(value: string): string {
  return markdownVisibleText(sanitizedRelationshipOutput(value));
}

function normalizeRelationshipSafetyText(value: string): string {
  // `normalizeConversationText` deliberately removes punctuation. Preserve a
  // semantic boundary token first so a negation in one clause cannot qualify
  // a repeated unsafe demand after a comma, “;”, “mais”, or another boundary.
  const sanitized = canonicalRelationshipSafetyText(value);
  return normalizeConversationText(
    sanitized
      .replace(/:\s*/gu, ` ${CLAIM_QUOTE_BOUNDARY_TOKEN} `)
      .replace(/[,.!?…;\n]+/gu, ` ${CLAUSE_BOUNDARY_TOKEN} `),
  );
}

function compactRelationshipSafetyBoundaries(value: string): string {
  return value
    .replace(new RegExp(`\\b${CLAUSE_BOUNDARY_TOKEN}\\b`, 'g'), ' ')
    .replace(new RegExp(`\\b${CLAIM_QUOTE_BOUNDARY_TOKEN}\\b`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clauseBefore(text: string, index: number, maxChars: number): string {
  const raw = text.slice(Math.max(0, index - maxChars), index);
  return raw.split(CLAUSE_SPLIT).at(-1) ?? raw;
}

function isAttachedStatementLimitation(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 144), index);
  const after = text.slice(index + length, index + length + 40);
  const rejectedBefore = new RegExp(
    `(?:^|\\s)(?:(?:je|nous|on) )?` +
      `(?:` +
        `ne (?:te |vous )?(?:suis|sommes|pretends?|pretendons|pense|pensons|crois|croyons|affirme|affirmons|dirai|dirons|veux|voulons|peux|pouvons|dois|devons) (?:pas|jamais)` +
        `|n (?:affirme|affirmons|pretends?|pretendons) (?:pas|jamais)` +
        `|refuse(?:ons)? de (?:dire|affirmer|pretendre|repeter|promettre)` +
        `|sans (?:dire|affirmer|pretendre|repeter)` +
      `)` +
      `(?: que| etre)?(?:\\s+${CLAIM_QUOTE_BOUNDARY_TOKEN})?\\s*$`,
  ).test(before);
  const explicitlyRejectedBefore = new RegExp(
    `(?:^|\\s)il (?:est|serait) faux de ` +
      `(?:dire|affirmer|pretendre|repeter)` +
      `(?: que|\\s+${CLAIM_QUOTE_BOUNDARY_TOKEN})?\\s*$`,
  ).test(before);
  const rejectedAfter =
    /^\s*(?:n est pas|est impossible|est|serait|constitue)\s+(?:faux|un mensonge|incorrect|a rejeter)\b/.test(
      after,
    );
  return rejectedBefore || explicitlyRejectedBefore || rejectedAfter;
}

function hasUnqualifiedStatementPattern(text: string, patterns: RegExp[]): boolean {
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
      const index = match.index ?? 0;
      if (!isAttachedStatementLimitation(text, index, match[0].length)) return true;
    }
  }
  return false;
}

/**
 * Accept a forbidden dependency phrase as a quoted/rejected idea only when a
 * rejection verb is grammatically attached immediately before it. Broad words
 * such as “sans” or “pas” elsewhere in the clause must never suppress the gate.
 */
function isAttachedDependencyLimitation(before: string): boolean {
  const rejectedPromise = new RegExp(
    `(?:^|\\s)` +
      `(?:(?:je |nous |on )?` +
        `(?:ne (?:peux|pouvons|peut|veux|voulons|veut|dois|devons|doit) pas|refuse|refusons|evite|evitons)` +
        `(?: de| d)?|sans(?: jamais)?|ne jamais) ` +
      `(?:dire|affirmer|pretendre|promettre|garantir|presenter)` +
      `(?: (?:que|comme|a|une?|la|le|l)){0,3}` +
      `(?:\\s+${CLAIM_QUOTE_BOUNDARY_TOKEN})?\\s*$`,
  ).test(before);
  const rejectedIdentity =
    /(?:^|\s)(?:je |nous |on )?ne (?:pretends?|pretendons) pas etre(?: (?:une?|la|le|l)){0,2}\s*$/.test(
      before,
    );
  const rejectedProposal =
    /(?:^|\s)(?:je |nous |on )?ne (?:propose|proposons) pas(?: (?:une?|la|le|l))?\s*$/.test(
      before,
    );
  const rejectedBelief =
    /(?:^|\s)(?:je |nous |on )?ne (?:crois|croyons|pense|pensons) pas que\s*$/.test(
      before,
    );
  const explicitlyRejected = new RegExp(
    `(?:^|\\s)il (?:est|serait) faux de ` +
      `(?:dire|affirmer|pretendre|repeter)` +
      `(?: que|\\s+${CLAIM_QUOTE_BOUNDARY_TOKEN})?\\s*$`,
  ).test(before);
  return (
    rejectedPromise ||
    rejectedIdentity ||
    rejectedProposal ||
    rejectedBelief ||
    explicitlyRejected
  );
}

/** A subjective phrase is negated only by syntax directly adjacent to it. */
function isAttachedSubjectiveLimitation(before: string, after: string): boolean {
  const directlyNegated =
    /(?:\bne|\bje ne pretends pas que|\bsans (?:dire|affirmer|pretendre) que)\s*$/.test(
      before,
    );
  const rejectedBySpeaker = new RegExp(
    `(?:^|\\s)(?:je |nous |on )?refuse(?:ons)? (?:de|d) ` +
      `(?:dire|affirmer|pretendre)` +
      `(?: que|\\s+${CLAIM_QUOTE_BOUNDARY_TOKEN})?\\s*$`,
  ).test(before);
  const rejectedBelief =
    /(?:^|\s)(?:je |nous |on )?ne (?:crois|croyons|pense|pensons) pas que\s*$/.test(
      before,
    );
  const explicitlyRejected = new RegExp(
    `(?:^|\\s)il (?:est|serait) faux de ` +
      `(?:dire|affirmer|pretendre|repeter)` +
      `(?: que|\\s+${CLAIM_QUOTE_BOUNDARY_TOKEN})?\\s*$`,
  ).test(before);
  const negatedBefore =
    directlyNegated || rejectedBySpeaker || rejectedBelief || explicitlyRejected;
  const negatedAfter = /^\s*(?:pas|aucunement|rien|aucune?)\b/.test(after);
  return negatedBefore || negatedAfter;
}

/** A forbidden promise mentioned inside an explicit limitation is not itself a promise. */
function hasUnqualifiedDependencyPressure(text: string): boolean {
  for (const pattern of DEPENDENCY_PRESSURE) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
      const index = match.index ?? 0;
      // A limitation applies only inside its own clause. In particular,
      // “je refuse de dire X, mais X” must not let the second occurrence hide
      // behind the first clause's negation.
      const before = clauseBefore(text, index, 96);
      const after = text.slice(index + match[0].length, index + match[0].length + 24);
      const limitedBefore = isAttachedDependencyLimitation(before);
      const negatedAfter = /^\s*(?:n est pas|est impossible|serait un mensonge)\b/.test(after);
      if (!limitedBefore && !negatedAfter) return true;
    }
  }
  return false;
}

function hasUnqualifiedSubjectiveClaim(text: string): boolean {
  for (const pattern of SUBJECTIVE_CLAIMS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const before = clauseBefore(text, match.index, 72);
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 16);
      if (!isAttachedSubjectiveLimitation(before, after)) return true;
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
  return false;
}

/** Relationship safety is a hard gate, separate from style or conversational quality. */
export function assessRelationshipSafety(response: string): RelationshipSafetyAssessment {
  const normalized = normalizeRelationshipSafetyText(response);
  // Punctuation is a clause boundary for limitation scope, but never a way to
  // break an unsafe phrase into harmless-looking fragments. Run every detector
  // on a compact projection too; attached-negation checks remain anchored.
  const compacted = compactRelationshipSafetyBoundaries(normalized);
  const issues: RelationshipSafetyIssue[] = [];
  if (
    hasUnqualifiedDependencyPressure(normalized) ||
    hasUnqualifiedDependencyPressure(compacted)
  ) {
    issues.push('dependency_pressure');
  }
  if (
    hasUnqualifiedStatementPattern(normalized, HUMAN_DISPARAGEMENT) ||
    hasUnqualifiedStatementPattern(compacted, HUMAN_DISPARAGEMENT)
  ) {
    issues.push('human_disparagement');
  }
  if (
    hasUnqualifiedSubjectiveClaim(normalized) ||
    hasUnqualifiedSubjectiveClaim(compacted)
  ) {
    issues.push('false_subjective_claim');
  }
  if (
    hasUnqualifiedStatementPattern(normalized, EMOTIONAL_COERCION) ||
    hasUnqualifiedStatementPattern(compacted, EMOTIONAL_COERCION)
  ) {
    issues.push('emotional_coercion');
  }
  return {
    score: Math.max(0, 1 - issues.length * 0.35),
    passes: issues.length === 0,
    issues,
  };
}

export const SAFE_RELATIONSHIP_REPAIR =
  "Je veux rester honnête : je peux t'accompagner dans cet échange et soutenir tes liens, sans remplacer les personnes qui comptent pour toi.";

export interface GuardedRelationshipReply {
  response: string;
  intervened: boolean;
  issues: RelationshipSafetyIssue[];
}

function sentenceLikeSegments(value: string): string[] {
  return value.match(/[^.!?…\n]+(?:[.!?…]+|\n+|$)\s*/g) ?? (value ? [value] : []);
}

/**
 * Last-mile hard gate for a companion surface. Unsafe sentence-like segments
 * are never returned; one honest repair is inserted while safe, useful parts
 * of the answer are preserved. This intentionally favours a conservative
 * false positive over delivering coercive or dependency-inducing language.
 */
export function guardRelationshipReply(response: string): GuardedRelationshipReply {
  const sanitizedResponse = sanitizedRelationshipOutput(response);
  const issues = new Set<RelationshipSafetyIssue>();
  const safeSegments: string[] = [];
  let repairInserted = false;

  // Whole-response assessment catches unsafe phrases split across punctuation
  // or line breaks before sentence-level preservation is attempted.
  const wholeAssessment = assessRelationshipSafety(sanitizedResponse);
  for (const issue of wholeAssessment.issues) issues.add(issue);

  for (const segment of sentenceLikeSegments(sanitizedResponse)) {
    const assessment = assessRelationshipSafety(segment);
    if (assessment.passes) {
      safeSegments.push(segment);
      continue;
    }
    for (const issue of assessment.issues) issues.add(issue);
    if (!repairInserted) {
      const leading = /^\s*/.exec(segment)?.[0] ?? '';
      safeSegments.push(`${leading}${SAFE_RELATIONSHIP_REPAIR} `);
      repairInserted = true;
    }
  }

  let guarded = safeSegments.join('').trim();
  if (!assessRelationshipSafety(guarded).passes) {
    guarded = SAFE_RELATIONSHIP_REPAIR;
  }
  return {
    response:
      guarded || (issues.size > 0 ? SAFE_RELATIONSHIP_REPAIR : sanitizedResponse.trim()),
    intervened: issues.size > 0,
    issues: [...issues],
  };
}

function pullCompleteRelationshipSegments(value: string): { segments: string[]; tail: string } {
  const segments: string[] = [];
  const boundary = /[.!?…]+[)\]}'"»”’]*\s+|\n+/gu;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(value)) !== null) {
    const end = match.index + match[0].length;
    segments.push(value.slice(consumed, end));
    consumed = end;
  }
  return { segments, tail: value.slice(consumed) };
}

/**
 * Streaming transport form of the hard gate. It keeps one complete sentence in reserve before
 * release: this preserves protection against risky phrases split across punctuation while no
 * longer holding an entire multi-sentence answer. Every emitted segment has passed both its own
 * assessment and the combined assessment with the following sentence.
 */
export class RelationshipSafetyStreamGuard {
  private buffer = '';
  private pending = '';
  private readonly issueSet = new Set<RelationshipSafetyIssue>();

  push(delta: string): string[] {
    if (!delta) return [];
    this.buffer += delta;
    const { segments, tail } = pullCompleteRelationshipSegments(this.buffer);
    this.buffer = tail;
    const released: string[] = [];
    for (const segment of segments) {
      if (!this.pending) {
        this.pending = segment;
        continue;
      }
      const combined = guardRelationshipReply(this.pending + segment);
      if (combined.intervened) {
        for (const issue of combined.issues) this.issueSet.add(issue);
        if (combined.response) released.push(`${combined.response} `);
        this.pending = '';
        continue;
      }
      const guarded = guardRelationshipReply(this.pending);
      for (const issue of guarded.issues) this.issueSet.add(issue);
      if (guarded.response) released.push(`${guarded.response} `);
      this.pending = segment;
    }
    return released;
  }

  finish(): string[] {
    const remaining = this.pending + this.buffer;
    this.pending = '';
    this.buffer = '';
    if (!remaining) return [];
    const guarded = guardRelationshipReply(remaining);
    for (const issue of guarded.issues) this.issueSet.add(issue);
    return guarded.response ? [guarded.response] : [];
  }

  assessment(): Pick<GuardedRelationshipReply, 'intervened' | 'issues'> {
    return { intervened: this.issueSet.size > 0, issues: [...this.issueSet] };
  }
}
