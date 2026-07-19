const prefixPattern = /^[A-Z][A-Z0-9_]{0,15}$/;

export function createId(prefix: string): string {
  const normalized = prefix.toUpperCase();
  if (!prefixPattern.test(normalized)) throw new Error("Invalid ID prefix");
  return `${normalized}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}
