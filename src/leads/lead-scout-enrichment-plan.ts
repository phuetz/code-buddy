import {
  LEAD_SCOUT_TARGETS,
  type LeadScoutTarget,
} from './lead-scout-plan.js';
import {
  buildResearchScriptJobArtifact,
  type ResearchScriptJobArtifact,
} from '../agent/research-script-job-artifact.js';

export type LeadScoutMissingField = 'email' | 'telephone' | 'site_web' | 'contact_url';

export const LEAD_SCOUT_MISSING_FIELDS: LeadScoutMissingField[] = [
  'email',
  'telephone',
  'site_web',
  'contact_url',
];

export interface LeadScoutEnrichmentPlanOptions {
  goal: string;
  target?: LeadScoutTarget;
  sourceUrlField?: string;
  websiteField?: string;
  nameField?: string;
  missingFields?: LeadScoutMissingField[];
  maxHops?: number;
  pageBudget?: number;
  delayMs?: number;
  allowedDomains?: string[];
  ignoredDomains?: string[];
  allowGeneratedScript?: boolean;
}

export interface LeadScoutEnrichmentHop {
  id: string;
  title: string;
  inputFields: string[];
  outputFields: string[];
  action: string;
  evidence: string;
  required: boolean;
}

export interface LeadScoutProtectedScript {
  language: 'python';
  dependencies: string[];
  inputContract: Record<string, string>;
  outputContract: Record<string, string>;
  jobArtifact: ResearchScriptJobArtifact;
  sandboxPolicy: {
    network: 'https_only_public_web';
    writes: 'output_path_only';
    timeoutMs: number;
    pageBudget: number;
    delayMs: number;
    stopOn: string[];
  };
  script?: string;
}

export interface LeadScoutEnrichmentPlan {
  goal: string;
  target: LeadScoutTarget;
  missingFields: LeadScoutMissingField[];
  sourceUrlField: string;
  websiteField: string;
  nameField: string;
  maxHops: number;
  pageBudget: number;
  delayMs: number;
  allowedDomains: string[];
  ignoredDomains: string[];
  principles: string[];
  hops: LeadScoutEnrichmentHop[];
  extractionRules: string[];
  safetyRules: string[];
  protectedScript: LeadScoutProtectedScript;
  agentTools: string[];
}

const DEFAULT_IGNORED_DOMAINS = [
  'architectes.org',
  'annuaire.architectes.org',
  'architectes-pour-tous.fr',
  'pagesjaunes.fr',
  'societe.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'google.com',
  'maps.google.',
];

const DEFAULT_MISSING_FIELDS: LeadScoutMissingField[] = ['email', 'telephone', 'site_web'];

const CONTACT_PATHS = [
  '/',
  '/contact',
  '/contact/',
  '/nous-contacter',
  '/agence',
  '/a-propos',
  '/about',
  '/mentions-legales',
];

export function buildLeadScoutEnrichmentPlan(
  options: LeadScoutEnrichmentPlanOptions,
): LeadScoutEnrichmentPlan {
  const goal = normalizeRequired(options.goal, 'goal');
  const target = normalizeTarget(options.target);
  const missingFields = normalizeMissingFields(options.missingFields);
  const sourceUrlField = normalizeText(options.sourceUrlField) || 'source_url';
  const websiteField = normalizeText(options.websiteField) || 'site_web';
  const nameField = normalizeText(options.nameField) || 'nom';
  const maxHops = normalizeBoundedInteger(options.maxHops, 3, 1, 5);
  const pageBudget = normalizeBoundedInteger(options.pageBudget, 8, 1, 30);
  const delayMs = normalizeBoundedInteger(options.delayMs, 1500, 250, 10000);
  const allowedDomains = normalizeStringArray(options.allowedDomains);
  const ignoredDomains = [...new Set([...DEFAULT_IGNORED_DOMAINS, ...normalizeStringArray(options.ignoredDomains)])];
  const allowGeneratedScript = options.allowGeneratedScript !== false;

  const planWithoutScript: Omit<LeadScoutEnrichmentPlan, 'protectedScript'> = {
    goal,
    target,
    missingFields,
    sourceUrlField,
    websiteField,
    nameField,
    maxHops,
    pageBudget,
    delayMs,
    allowedDomains,
    ignoredDomains,
    principles: buildPrinciples(),
    hops: buildHops(sourceUrlField, websiteField, nameField, missingFields),
    extractionRules: buildExtractionRules(missingFields),
    safetyRules: buildSafetyRules(),
    agentTools: [
      'lead_scout_enrichment_plan',
      'lead_scout_run',
      'lead_scout_lesson_candidates',
      'internet_scout_plan',
      'run_script',
      'lessons_add',
    ],
  };

  return {
    ...planWithoutScript,
    protectedScript: buildProtectedScript(planWithoutScript, allowGeneratedScript),
  };
}

export function renderLeadScoutEnrichmentPlan(plan: LeadScoutEnrichmentPlan): string {
  const lines = [
    `# Lead Scout Enrichment Plan: ${plan.goal}`,
    '',
    `Target: ${plan.target}`,
    `Missing fields: ${plan.missingFields.join(', ')}`,
    `Page budget: ${plan.pageBudget}`,
    `Delay: ${plan.delayMs}ms`,
    '',
    '## Principles',
    ...plan.principles.map((principle) => `- ${principle}`),
    '',
    '## Multi-hop Chain',
    ...plan.hops.map((hop, index) => `${index + 1}. ${hop.title} [${hop.required ? 'required' : 'optional'}] - ${hop.action}`),
    '',
    '## Extraction Rules',
    ...plan.extractionRules.map((rule) => `- ${rule}`),
    '',
    '## Protected Script',
    `- Language: ${plan.protectedScript.language}`,
    `- Dependencies: ${plan.protectedScript.dependencies.join(', ')}`,
    `- Network: ${plan.protectedScript.sandboxPolicy.network}`,
    `- Writes: ${plan.protectedScript.sandboxPolicy.writes}`,
    `- Stop on: ${plan.protectedScript.sandboxPolicy.stopOn.join(', ')}`,
    '',
    '## Safety Rules',
    ...plan.safetyRules.map((rule) => `- ${rule}`),
  ];

  if (plan.allowedDomains.length > 0) {
    lines.push('', '## Allowed Domains', ...plan.allowedDomains.map((domain) => `- ${domain}`));
  }

  return lines.filter((line) => line !== '').join('\n');
}

function buildPrinciples(): string[] {
  return [
    'Model the task as a graph of evidence, not a single-page extraction.',
    'Use each discovered field as a hypothesis that must be confirmed by a public source.',
    'Keep the script deterministic and reproducible so a human can inspect what happened.',
    'Separate understanding from execution: the LLM designs the strategy, the sandbox runs bounded code.',
    'Prefer small, resumable batches over one large crawl.',
    'Every enriched phone, email, or website must carry the URL and snippet that justified it.',
  ];
}

function buildHops(
  sourceUrlField: string,
  websiteField: string,
  nameField: string,
  missingFields: LeadScoutMissingField[],
): LeadScoutEnrichmentHop[] {
  const needsWebsite = missingFields.includes('site_web') || missingFields.includes('contact_url');
  const outputFields = [...new Set([websiteField, ...missingFields])];

  return [
    {
      id: 'seed-profile',
      title: 'Read the source profile page',
      inputFields: [nameField, sourceUrlField],
      outputFields: needsWebsite ? [websiteField, 'evidence'] : ['evidence'],
      action: 'Fetch the known directory/profile URL, extract official website links, and ignore generic portals.',
      evidence: 'Profile URL, page title, extracted website URL, and short snippet.',
      required: true,
    },
    {
      id: 'official-site',
      title: 'Open the official website',
      inputFields: [websiteField],
      outputFields: ['homepage_evidence', ...missingFields],
      action: 'Fetch the official website homepage and collect mailto/tel links plus visible contact text.',
      evidence: 'Official domain URL, HTTP status, and extracted contact snippet.',
      required: true,
    },
    {
      id: 'contact-pages',
      title: 'Explore contact-like pages',
      inputFields: [websiteField],
      outputFields,
      action: `Try bounded contact paths (${CONTACT_PATHS.join(', ')}) and same-domain contact/about links found on the homepage.`,
      evidence: 'Each contact candidate URL, extracted fields, and first matching snippet.',
      required: false,
    },
    {
      id: 'verify-and-merge',
      title: 'Verify and merge extracted fields',
      inputFields: [nameField, websiteField, ...missingFields],
      outputFields: ['enrichment', 'confidence', 'status'],
      action: 'Prefer same-domain emails, French phone-like numbers, and fields backed by explicit source URLs.',
      evidence: 'Evidence chain from profile URL to website URL to contact page URL.',
      required: true,
    },
  ];
}

function buildExtractionRules(missingFields: LeadScoutMissingField[]): string[] {
  const rules = [
    'Treat the lead page, official website, and contact page as a linked evidence chain.',
    'Reject generic directory, social, map, marketplace, and unrelated domains as official websites.',
    'Stay on the same official domain after the website hop unless the user provided an allowed domain.',
    'Keep every extracted value with source_url, page_title, snippet, and observed_at.',
  ];

  if (missingFields.includes('email')) {
    rules.push('Extract email from mailto links first, then visible text, then HTML attributes; prefer same-domain contact/info/agence emails.');
  }
  if (missingFields.includes('telephone')) {
    rules.push('Extract phone from tel links first, then visible French phone patterns; reject fax-only or malformed numbers when detectable.');
  }
  if (missingFields.includes('site_web')) {
    rules.push('Extract official website from profile labels or outbound links, then normalize malformed http/https prefixes.');
  }
  if (missingFields.includes('contact_url')) {
    rules.push('Record the most relevant same-domain contact/about/agence/mentions URL as contact_url.');
  }

  return rules;
}

function buildSafetyRules(): string[] {
  return [
    'Use public professional B2B pages only.',
    'Do not bypass captcha, login walls, paywalls, anti-bot checks, robots/rate-limit signals, or access controls.',
    'Use bounded page budgets, delays between requests, and one retry maximum for transient network failures.',
    'Do not send emails or submit forms; generate review data only.',
    'Store evidence snippets, not raw page dumps.',
    'Stop on HTTP 403, 429, captcha-like pages, credential prompts, or private personal data unrelated to the B2B goal.',
  ];
}

function buildProtectedScript(
  plan: Omit<LeadScoutEnrichmentPlan, 'protectedScript'>,
  includeScript: boolean,
): LeadScoutProtectedScript {
  const inputContract = {
    LEADS_JSON: 'Path to an input JSON array of lead records.',
    OUTPUT_JSON: 'Path where the script writes the enriched JSON array.',
    LIMIT: 'Optional maximum number of leads to process.',
  };
  const outputContract = {
    enriched: 'Array of original lead records plus enrichment fields and evidence_chain.',
    skipped: 'Rows skipped with reason.',
    stats: 'Processed, enriched, skipped, and blocked counts.',
  };
  const sandboxPolicy = {
    network: 'https_only_public_web' as const,
    writes: 'output_path_only' as const,
    timeoutMs: 120000,
    pageBudget: plan.pageBudget,
    delayMs: plan.delayMs,
    stopOn: ['captcha', 'login', 'paywall', '403', '429', 'private_data', 'non_public_domain'],
  };

  return {
    language: 'python',
    dependencies: ['requests', 'beautifulsoup4'],
    inputContract,
    outputContract,
    jobArtifact: buildResearchScriptJobArtifact({
      goal: plan.goal,
      title: `Lead Scout ${plan.target} public enrichment script`,
      language: 'python',
      scriptFileName: 'enrich-leads.py',
      inputContract,
      outputContract,
      command: {
        executable: 'python',
        args: ['enrich-leads.py'],
        env: {
          LEADS_JSON: 'input.json',
          OUTPUT_JSON: 'output.json',
          LIMIT: 'optional integer limit',
        },
      },
      sandboxPolicy: {
        provider: 'local',
        network: 'https_only_public_web',
        writes: 'output_path_only',
        timeoutMs: sandboxPolicy.timeoutMs,
        pageBudget: sandboxPolicy.pageBudget,
        delayMs: sandboxPolicy.delayMs,
        allowedDomains: plan.allowedDomains,
        ignoredDomains: plan.ignoredDomains,
        stopOn: sandboxPolicy.stopOn,
        cleanup: 'keep_all_artifacts',
      },
      assertions: [
        {
          id: 'output-json-written',
          kind: 'file_exists',
          description: 'The enrichment script writes output.json in the job artifact folder.',
          required: true,
        },
        {
          id: 'evidence-chain-preserved',
          kind: 'evidence',
          description: 'Every enriched phone, email, website, or contact URL carries evidence_chain entries.',
          required: true,
        },
        {
          id: 'no-contact-action',
          kind: 'no_contact_action',
          description: 'The script does not send emails, submit forms, or contact leads.',
          required: true,
        },
      ],
    }),
    sandboxPolicy,
    ...(includeScript ? { script: renderPythonScript(plan) } : {}),
  };
}

function renderPythonScript(plan: Omit<LeadScoutEnrichmentPlan, 'protectedScript'>): string {
  return `#!/usr/bin/env python3
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

SOURCE_URL_FIELD = ${JSON.stringify(plan.sourceUrlField)}
WEBSITE_FIELD = ${JSON.stringify(plan.websiteField)}
NAME_FIELD = ${JSON.stringify(plan.nameField)}
MISSING_FIELDS = ${JSON.stringify(plan.missingFields)}
IGNORED_DOMAINS = ${JSON.stringify(plan.ignoredDomains)}
ALLOWED_DOMAINS = ${JSON.stringify(plan.allowedDomains)}
CONTACT_PATHS = ${JSON.stringify(CONTACT_PATHS)}
PAGE_BUDGET = ${plan.pageBudget}
DELAY_SECONDS = ${plan.delayMs / 1000}
HEADERS = {
    "User-Agent": "CodeBuddy-LeadScout/1.0 (+public B2B enrichment; no form submit)",
    "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
}


def normalize_url(url):
    if not url:
        return ""
    value = str(url).strip()
    value = re.sub(r"^https?://(https?://)", r"\\1", value, flags=re.I)
    if value.startswith("www."):
        value = "https://" + value
    return value


def domain_of(url):
    return urlparse(normalize_url(url)).netloc.lower().replace("www.", "")


def ignored(url):
    domain = domain_of(url)
    if not domain:
        return True
    if ALLOWED_DOMAINS and not any(allowed in domain for allowed in ALLOWED_DOMAINS):
        return True
    return any(blocked in domain for blocked in IGNORED_DOMAINS)


def safe_get(session, url):
    url = normalize_url(url)
    if not url.startswith(("http://", "https://")) or ignored(url):
        return None, "blocked_domain"
    try:
        response = session.get(url, headers=HEADERS, timeout=12, allow_redirects=True)
    except requests.RequestException as exc:
        return None, str(exc)
    if response.status_code in (403, 429):
        return None, f"HTTP {response.status_code}"
    text = response.text[:200000]
    lowered = text.lower()
    if "captcha" in lowered or "connexion" in lowered and "mot de passe" in lowered:
        return None, "access_wall"
    return response, None


def extract_contacts(html, page_url):
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    emails = set()
    phones = set()
    contact_links = set()
    websites = set()
    for link in soup.find_all("a", href=True):
        href = link["href"].strip()
        label = link.get_text(" ", strip=True).lower()
        if href.startswith("mailto:"):
            emails.add(href.replace("mailto:", "").split("?")[0].strip().lower())
        elif href.startswith("tel:"):
            phones.add(href.replace("tel:", "").strip())
        else:
            absolute = urljoin(page_url, href)
            if any(word in (href + " " + label).lower() for word in ["contact", "agence", "about", "a-propos", "mentions"]):
                if domain_of(absolute) == domain_of(page_url):
                    contact_links.add(absolute)
            if absolute.startswith(("http://", "https://")) and not ignored(absolute):
                websites.add(absolute)
    for email in re.findall(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}", html):
        emails.add(email.lower())
    for phone in re.findall(r"(?:\\+33|0)[\\s.\\-]*(?:[1-9])(?:[\\s.\\-]*\\d{2}){4}", text):
        phones.add(phone)
    return {
        "emails": sorted(emails),
        "phones": sorted(phones),
        "websites": sorted(websites),
        "contact_links": sorted(contact_links),
        "snippet": text[:500],
    }


def best_email(emails, website):
    website_domain = domain_of(website)
    def score(email):
        domain = email.split("@")[-1]
        if website_domain and website_domain in domain:
            return 0
        if email.startswith(("contact@", "info@", "agence@")):
            return 1
        return 2
    return sorted(emails, key=score)[0] if emails else ""


def enrich_one(session, lead):
    evidence_chain = []
    pages_seen = 0
    website = normalize_url(lead.get(WEBSITE_FIELD) or "")
    source_url = normalize_url(lead.get(SOURCE_URL_FIELD) or "")
    candidates = []
    if source_url:
        candidates.append(("profile", source_url))
    if website:
        candidates.append(("website", website))
    enrichment = {}

    for kind, url in list(candidates):
        if pages_seen >= PAGE_BUDGET:
            break
        time.sleep(DELAY_SECONDS)
        response, error = safe_get(session, url)
        pages_seen += 1
        if error:
            evidence_chain.append({"url": url, "kind": kind, "blocked": error})
            continue
        contacts = extract_contacts(response.text, response.url)
        evidence_chain.append({"url": response.url, "kind": kind, "snippet": contacts["snippet"]})
        if not website and contacts["websites"]:
            website = contacts["websites"][0]
            enrichment[WEBSITE_FIELD] = website
            candidates.append(("website", website))
        if "email" in MISSING_FIELDS and not enrichment.get("email"):
            email = best_email(contacts["emails"], website)
            if email:
                enrichment["email"] = email
        if "telephone" in MISSING_FIELDS and not enrichment.get("telephone") and contacts["phones"]:
            enrichment["telephone"] = contacts["phones"][0]
        if "contact_url" in MISSING_FIELDS and not enrichment.get("contact_url") and contacts["contact_links"]:
            enrichment["contact_url"] = contacts["contact_links"][0]
        for contact_url in contacts["contact_links"][:3] + [urljoin(response.url, path) for path in CONTACT_PATHS]:
            if pages_seen >= PAGE_BUDGET:
                break
            if contact_url not in [candidate[1] for candidate in candidates]:
                candidates.append(("contact", contact_url))

    enriched = dict(lead)
    enriched.update({key: value for key, value in enrichment.items() if value})
    enriched["evidence_chain"] = evidence_chain[:PAGE_BUDGET]
    enriched["enrichment_status"] = "enriched" if enrichment else "needs_review"
    enriched["observed_at"] = datetime.now(timezone.utc).isoformat()
    return enriched


def main():
    input_path = os.environ["LEADS_JSON"]
    output_path = os.environ["OUTPUT_JSON"]
    limit = int(os.environ.get("LIMIT", "50"))
    with open(input_path, "r", encoding="utf-8") as handle:
        leads = json.load(handle)
    session = requests.Session()
    enriched = [enrich_one(session, lead) for lead in leads[:limit]]
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump({"enriched": enriched, "stats": {"processed": len(enriched)}}, handle, ensure_ascii=False, indent=2)
    print(json.dumps({"processed": len(enriched), "output": output_path}))


if __name__ == "__main__":
    main()
`;
}

function normalizeText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function normalizeRequired(value: string, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function normalizeTarget(target: LeadScoutTarget | undefined): LeadScoutTarget {
  if (!target) {
    return 'custom';
  }
  if (!LEAD_SCOUT_TARGETS.includes(target)) {
    throw new Error(`target must be one of: ${LEAD_SCOUT_TARGETS.join(', ')}`);
  }
  return target;
}

function normalizeMissingFields(fields: LeadScoutMissingField[] | undefined): LeadScoutMissingField[] {
  const candidateFields = fields && fields.length > 0 ? fields : DEFAULT_MISSING_FIELDS;
  const uniqueFields: LeadScoutMissingField[] = [];
  for (const field of candidateFields) {
    if (!LEAD_SCOUT_MISSING_FIELDS.includes(field)) {
      throw new Error(`missingFields must contain only: ${LEAD_SCOUT_MISSING_FIELDS.join(', ')}`);
    }
    if (!uniqueFields.includes(field)) {
      uniqueFields.push(field);
    }
  }
  return uniqueFields;
}

function normalizeBoundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  return values.map((value) => normalizeText(value)).filter((value) => value.length > 0);
}
