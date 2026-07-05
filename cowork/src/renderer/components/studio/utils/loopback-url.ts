function isIpv4Loopback(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const numbers = parts.map((part) => Number(part));
  return numbers.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && numbers[0] === 127;
}

export function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return hostname === 'localhost' || hostname === '::1' || isIpv4Loopback(hostname);
  } catch {
    return false;
  }
}
