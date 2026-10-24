// Throwaway file for a /review-pr live test. Do not merge.

export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError("clamp: min must not exceed max");
  return Math.min(Math.max(value, min), max);
}

export function average(values: number[]): number {
  if (values.length === 0) throw new RangeError("average: values must not be empty");
  return values.reduce((a, b) => a + b, 0) / values.length;
}
