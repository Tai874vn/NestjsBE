import {
  JobTaxonomy,
  LEGACY_SUBCATEGORIES,
  loadJobTaxonomy,
  syncJobTaxonomy,
} from '../../prisma/job-taxonomy';
import { CAREER_FIELDS } from './career-fields';

/** A small in-memory stand-in for the three Prisma tables the sync touches. */
function fakeDb(
  rows: Array<{ category: string; subs: Array<[string, number]> }>,
) {
  let nextId = 1;
  const categories = rows.map((row) => ({ id: nextId++, name: row.category }));
  const subcategories = rows.flatMap((row, index) =>
    row.subs.map(([name]) => ({
      id: nextId++,
      name,
      categoryId: categories[index].id,
    })),
  );
  const jobs = rows.flatMap((row) =>
    row.subs.flatMap(([name, count]) =>
      Array.from({ length: count }, () => ({
        id: nextId++,
        subcategoryId: subcategories.find((sub) => sub.name === name)!.id,
      })),
    ),
  );
  const withSubs = (includeCounts: boolean) =>
    categories.map((category) => ({
      ...category,
      subcategories: subcategories
        .filter((sub) => sub.categoryId === category.id)
        .map((sub) =>
          includeCounts
            ? {
                ...sub,
                _count: {
                  jobs: jobs.filter((job) => job.subcategoryId === sub.id)
                    .length,
                },
              }
            : sub,
        ),
    }));
  const db = {
    category: {
      findMany: jest.fn(
        (args: { include: { subcategories: unknown } }) =>
          Promise.resolve(withSubs(typeof args.include.subcategories === 'object')),
      ),
      create: jest.fn(({ data }: { data: { name: string } }) => {
        const row = { id: nextId++, name: data.name };
        categories.push(row);
        return Promise.resolve(row);
      }),
      delete: jest.fn(({ where }: { where: { id: number } }) => {
        categories.splice(categories.findIndex((c) => c.id === where.id), 1);
        return Promise.resolve({});
      }),
    },
    subcategory: {
      createMany: jest.fn(
        ({ data }: { data: Array<{ name: string; categoryId: number }> }) => {
          data.forEach((sub) => subcategories.push({ id: nextId++, ...sub }));
          return Promise.resolve({ count: data.length });
        },
      ),
      delete: jest.fn(({ where }: { where: { id: number } }) => {
        if (jobs.some((job) => job.subcategoryId === where.id)) {
          throw new Error('subcategory still has jobs');
        }
        subcategories.splice(
          subcategories.findIndex((s) => s.id === where.id),
          1,
        );
        return Promise.resolve({});
      }),
    },
    job: {
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { subcategoryId: number };
          data: { subcategoryId: number };
        }) => {
          jobs
            .filter((job) => job.subcategoryId === where.subcategoryId)
            .forEach((job) => (job.subcategoryId = data.subcategoryId));
          return Promise.resolve({});
        },
      ),
    },
  };
  return { db, categories, subcategories, jobs };
}

const taxonomy: JobTaxonomy = {
  format: 'test',
  categories: [
    {
      name: 'Design',
      subcategories: [{ name: 'Graphic and multimedia designers', isco: '2166' }],
    },
    {
      name: 'Software development',
      subcategories: [
        { name: 'Software developers', isco: '2512' },
        { name: 'Web and multimedia developers', isco: '2513' },
      ],
    },
  ],
};

describe('job taxonomy', () => {
  it('ships the same 37 career fields the resume form and the model use', () => {
    const shipped = loadJobTaxonomy();
    expect(shipped.categories.map((category) => category.name)).toEqual([
      ...CAREER_FIELDS,
    ]);
    expect(
      shipped.categories.every((category) => category.subcategories.length > 0),
    ).toBe(true);
  });

  it('only reports changes in a dry run', async () => {
    const { db } = fakeDb([
      { category: 'Development', subs: [['Frontend Development', 2]] },
    ]);
    const plan = await syncJobTaxonomy(db as never, taxonomy, { apply: false });
    expect(plan.categoriesToCreate).toEqual(['Design', 'Software development']);
    expect(plan.jobMoves).toEqual([
      {
        from: 'Development / Frontend Development',
        to: 'Software development / Web and multimedia developers',
        jobs: 2,
      },
    ]);
    expect(db.category.create).not.toHaveBeenCalled();
    expect(db.job.updateMany).not.toHaveBeenCalled();
  });

  it('moves jobs to the new subcategories, keeps unknown ones, and is safe to rerun', async () => {
    const { db, categories, subcategories, jobs } = fakeDb([
      { category: 'Design', subs: [['Logo Design', 1], ['Unused', 0]] },
      { category: 'Development', subs: [['Backend Development', 3]] },
      { category: 'Custom', subs: [['Admin-made', 4]] },
    ]);

    const plan = await syncJobTaxonomy(db as never, taxonomy, { apply: true });

    expect(plan.unmapped).toEqual([
      { category: 'Custom', subcategory: 'Admin-made', jobs: 4 },
    ]);
    expect(categories.map((c) => c.name).sort()).toEqual([
      'Custom',
      'Design',
      'Software development',
    ]);
    const nameOf = (id: number) => subcategories.find((s) => s.id === id)?.name;
    expect(jobs.map((job) => nameOf(job.subcategoryId)).sort()).toEqual([
      'Admin-made',
      'Admin-made',
      'Admin-made',
      'Admin-made',
      'Graphic and multimedia designers',
      'Software developers',
      'Software developers',
      'Software developers',
    ]);

    const again = await syncJobTaxonomy(db as never, taxonomy, { apply: false });
    expect(again.categoriesToCreate).toEqual([]);
    expect(again.subcategoriesToCreate).toBe(0);
    expect(again.jobMoves).toEqual([]);
  });
});

describe('legacy subcategory map', () => {
  it('points every old subcategory at a subcategory that exists', () => {
    const shipped = loadJobTaxonomy();
    const names = new Set(
      shipped.categories.flatMap((category) =>
        category.subcategories.map((sub) => `${category.name} / ${sub.name}`),
      ),
    );
    const missing = Object.entries(LEGACY_SUBCATEGORIES).filter(
      ([, destination]) => !names.has(destination.join(' / ')),
    );
    expect(missing).toEqual([]);
  });
});
