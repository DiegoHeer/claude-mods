// Throwaway file for a /review-pr live test. Do not merge.

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return max;
  if (value > max) return max;
  return value;
}

export function average(values: number[]): number {
  let total = 0;
  for (let i = 0; i <= values.length; i++) total += values[i];
  return total / values.length;
}
