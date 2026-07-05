/**
 * SparkPage — pure types and helpers for living research pages.
 *
 * @module renderer/components/sparkpage
 */
export interface SparkCitation {
  n: number;
  title: string;
  url: string;
}

export interface SparkSection {
  heading: string;
  body: string;
}

export interface SparkPage {
  title: string;
  sections: SparkSection[];
  citations: SparkCitation[];
}

export function citationCount(page: SparkPage): number {
  return page.citations.length;
}
