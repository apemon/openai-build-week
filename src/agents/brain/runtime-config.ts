export const DEFAULT_BRAIN_TIMEOUT_MS = 120_000;
export const MIN_BRAIN_TIMEOUT_MS = 30_000;
export const MAX_BRAIN_TIMEOUT_MS = 300_000;

export class BrainTimeoutConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrainTimeoutConfigurationError";
  }
}

/** Parses the optional server timeout without accepting whitespace, decimals,
 * exponents, signs, or leading zeroes. */
export function parseBrainTimeoutMs(value: string | undefined): number {
  if (value === undefined) return DEFAULT_BRAIN_TIMEOUT_MS;
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new BrainTimeoutConfigurationError("OPENAI_BRAIN_TIMEOUT_MS must be a base-10 integer without whitespace or leading zeroes.");
  }
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_BRAIN_TIMEOUT_MS || timeoutMs > MAX_BRAIN_TIMEOUT_MS) {
    throw new BrainTimeoutConfigurationError(`OPENAI_BRAIN_TIMEOUT_MS must be between ${MIN_BRAIN_TIMEOUT_MS} and ${MAX_BRAIN_TIMEOUT_MS}.`);
  }
  return timeoutMs;
}
