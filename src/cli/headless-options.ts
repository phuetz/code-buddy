export interface HeadlessOutputOptions {
  output?: string;
  outputFormat?: string;
}

export function resolveHeadlessOutputFormat(options: HeadlessOutputOptions): string {
  return options.outputFormat || options.output || 'json';
}
