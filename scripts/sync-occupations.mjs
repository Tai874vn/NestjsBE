// Copies the ESCO occupation catalogue from the AI service into the backend,
// keeping only what the backend reads (code, isco, title, altLabels, specialties, related).
// Usage: node scripts/sync-occupations.mjs [path/to/occupations.json]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(
  process.argv[2] ??
    'E:/Final_Year_Project/AIService/app/data/occupations.json',
);
const target = resolve(here, '..', 'src', 'common', 'data', 'occupations.json');

const catalogue = JSON.parse(readFileSync(source, 'utf8'));
const slim = {
  version: catalogue.version,
  occupations: catalogue.occupations.map((o) => ({
    code: o.code,
    isco: o.isco,
    title: o.title,
    altLabels: o.altLabels,
    specialties: o.specialties,
    related: o.related,
  })),
};
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(slim));
console.log(`${slim.occupations.length} occupations -> ${target}`);
