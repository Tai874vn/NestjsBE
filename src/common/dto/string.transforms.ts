type TransformParams = {
  value: unknown;
};

export function trimString({ value }: TransformParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

// @find shared input trim logic [all] — removes spaces at both ends; empty becomes "not sent"
export function optionalTrimString({ value }: TransformParams): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeEmail({ value }: TransformParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export function optionalNormalizeEmail({ value }: TransformParams): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
}
