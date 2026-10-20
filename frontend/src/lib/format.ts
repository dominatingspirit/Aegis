export const inr = (n: number): string =>
  `₹${Math.round(n).toLocaleString('en-IN')}`;

// Backwards-compatible alias for existing imports across components
export const usd = inr;

export const signed = (n: number, suffix = ''): string => `${n > 0 ? '+' : ''}${n}${suffix}`;

/** HH:MM:SS.mmm wall-clock stamp for the audit log. */
export function logStamp(date: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
