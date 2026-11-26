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

/** A list from the URL: `?a=x,y` or `?a=x&a=y` -> ['x', 'y'] (trimmed, empty items dropped). Nothing left: not sent. */
export function commaList({ value }: TransformParams): unknown {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value : [value];
  if (raw.some((item) => typeof item !== 'string')) return value;
  const items = (raw as string[])
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}
