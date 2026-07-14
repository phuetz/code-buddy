export interface FreshContextCitation {
  title: string;
  url: string;
  source?: string;
  publishedAt?: string;
}

export interface NewsDigestItem extends FreshContextCitation {
  summary?: string;
}

export interface NewsDigest {
  kind: 'news';
  query: string;
  locale: string;
  fetchedAt: number;
  items: NewsDigestItem[];
}

export type FreshContextPayload = NewsDigest;

export interface FormattedFreshContext {
  speech: string;
  text: string;
  citations: FreshContextCitation[];
}

function cleanSentence(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .replace(/[.;:,\s]+$/g, '')
    .trim();
}

const GENERIC_NEWS_TITLE =
  /\b(actualites? (?:du jour|en direct|en temps reel|tech|videos? et infos? en direct)|intelligence artificielle actualites videos? et infos? en direct|info en continu|toute l actualite|toute l information|archives du monde|consultez tous les articles|world news|latest (?:ai )?news|leading french newspaper|infos? news actualites?|l information internationale en direct)\b/i;
const GENERIC_NEWS_SUMMARY =
  /\b(explore the latest|decrypte l actualite|analyses? des interviews|reportages exclusifs|toute l information|latest artificial intelligence news)\b/i;
const SUMMARY_EMPHASIS = /<(?:strong|b|em)\b[^>]*>([\s\S]*?)<\/(?:strong|b|em)>/gi;

function foldForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSummaryCandidate(value: string): string {
  let candidate = cleanSentence(value)
    .replace(/^(?:nouvelle notification|en direct|direct)\s*/i, '')
    .replace(/\s+\d+\s*(?:min|h\d*|heures?)$/i, '')
    .replace(/\s+(?:publie|mis a jour)\s+le\s+\d{1,2}\b.*$/i, '')
    .trim();
  const firstSentence = candidate.match(/^(.{24,320}?[.!?])(?:\s|$)/)?.[1]?.trim();
  if (firstSentence && !firstSentence.endsWith('...')) candidate = cleanSentence(firstSentence);
  if (candidate.length > 220) {
    const prefix = candidate.slice(0, 217);
    const boundaries = [...prefix.matchAll(/[.!?;:,](?=\s|$)/g)];
    const lastBoundary = boundaries.at(-1)?.index ?? -1;
    candidate = `${prefix.slice(0, lastBoundary >= 120 ? lastBoundary : prefix.length).trimEnd()}…`;
  }
  return candidate.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase('fr'));
}

function isConcreteSummaryCandidate(value: string): boolean {
  if (!value || value.length < 24 || value.includes('�')) return false;
  const folded = foldForMatch(value);
  if (GENERIC_NEWS_SUMMARY.test(folded) || GENERIC_NEWS_TITLE.test(folded)) return false;
  const words = folded.split(' ').filter(Boolean);
  if (words.length < 5) return false;

  // Search snippets often begin with a detached teaser such as
  // “Ce sera massif” : Emmanuel Macron… It names a speaker but not an event.
  // A quoted lead is only useful when the surrounding text explains it.
  if (/^["«“]/.test(value)) {
    const closingQuote = value.search(/["»”]/);
    if (closingQuote > 0) {
      const outsideWords = foldForMatch(value.slice(closingQuote + 1)).split(' ').filter(Boolean);
      if (outsideWords.length < 4) return false;
    }
  }
  return true;
}

function concreteSummaryTitle(rawSummary: string): string {
  const emphasized = Array.from(rawSummary.matchAll(SUMMARY_EMPHASIS), (match) => match[1] ?? '');
  const ordinarySegments = rawSummary.split(/\s+[·|]\s+|\n+|\.{3,}|…+/g);
  for (const rawCandidate of [...emphasized, ...ordinarySegments]) {
    const candidate = normalizeSummaryCandidate(rawCandidate);
    if (isConcreteSummaryCandidate(candidate)) return candidate;
  }
  return '';
}

/** Search engines sometimes return a media homepage as title and the real headline in its snippet. */
function concreteNewsTitle(item: NewsDigestItem): string {
  const title = cleanSentence(item.title);
  const foldedTitle = foldForMatch(title);
  if (!GENERIC_NEWS_TITLE.test(foldedTitle) && !/^franceinfo\b/i.test(foldedTitle)) return title;
  return concreteSummaryTitle(item.summary ?? '');
}

function isProbablyFrench(text: string): boolean {
  const normalized = ` ${cleanSentence(text).toLowerCase()} `;
  const french = normalized.match(/\b(?:le|la|les|des|une|un|du|dans|pour|avec|sur|qui|que|est|sont)\b/g)?.length ?? 0;
  const english = normalized.match(/\b(?:the|and|with|from|latest|rise|news|into|once|did|does)\b/g)?.length ?? 0;
  return english < 2 || french >= english;
}

function formatCollectionDate(fetchedAt: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'long',
      timeZone: 'Europe/Paris',
    }).format(new Date(fetchedAt));
  } catch {
    return new Date(fetchedAt).toISOString().slice(0, 10);
  }
}

export function formatNewsDigest(
  digest: NewsDigest,
  options: { stale?: boolean; now?: number; maxItems?: number } = {}
): FormattedFreshContext {
  const now = options.now ?? Date.now();
  const maxItems = Math.max(1, Math.min(5, options.maxItems ?? 4));
  const candidates = digest.items
    .map((item) => {
      const spokenTitle = concreteNewsTitle(item);
      return { item, spokenTitle, likelyFrench: isProbablyFrench(spokenTitle) };
    })
    .filter(({ spokenTitle }) => spokenTitle);
  const frenchCandidates = candidates.filter(({ likelyFrench }) => likelyFrench);
  const preferred = digest.locale.toLowerCase().startsWith('fr') && frenchCandidates.length >= 2
    ? frenchCandidates
    : candidates;
  const items = preferred.slice(0, maxItems);
  if (items.length === 0) {
    return { speech: '', text: '', citations: [] };
  }

  const ageMinutes = Math.max(0, Math.round((now - digest.fetchedAt) / 60_000));
  const collectionDate = formatCollectionDate(digest.fetchedAt, digest.locale);
  const lead = options.stale
    ? `Je n'ai pas pu rafraîchir les sources. Mon dernier bulletin, collecté le ${collectionDate}, date d'environ ${Math.max(1, ageMinutes)} minutes.`
    : items.length === 1
      ? `Voici le sujet récent que j'ai pu vérifier, collecté le ${collectionDate}.`
      : `Voici ${items.length} sujets récents que j'ai pu vérifier, collectés le ${collectionDate}.`;
  const spokenItems = items.map(({ item, spokenTitle }, index) => {
    const source = cleanSentence(item.source ?? '');
    return `${index + 1}, ${spokenTitle}${source ? `, selon ${source}` : ''}.`;
  });
  const speech = [lead, ...spokenItems].join(' ');
  const text = [
    lead,
    ...items.map(({ item, spokenTitle }, index) => {
      const details = [item.source, item.publishedAt].filter(Boolean).join(' · ');
      return `${index + 1}. ${spokenTitle}${details ? ` — ${details}` : ''}${item.url ? `\n${item.url}` : ''}`;
    }),
  ].join('\n');

  return {
    speech,
    text,
    citations: items.map(({ item, spokenTitle }) => ({
      title: spokenTitle,
      url: item.url,
      ...(item.source ? { source: item.source } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    })),
  };
}
