import {
  cleanResumeJobs,
  occupationYears,
  relatedYears,
  yearsInOccupation,
} from './resume-career';

// The B1 tests of `occupation_years` in AIService tests/test_occupations.py, with the same numbers.
const TODAY = new Date(2026, 10, 16);
const job = (occupation: string | null, start: string, end: string | null = null) => ({
  occupation,
  start,
  end,
});

describe('occupationYears (mirrors AIService occupation_years)', () => {
  it('gives a business analyst small credit', () => {
    const jobs = [job('2511.8', '2022-11', '2024-11'), job('2512.3', '2024-11')];
    expect(occupationYears(jobs, '2512.3', TODAY)).toEqual({ years: 2.0, related: 0.2 });
  });

  it('gives almost nothing for an unrelated job', () => {
    // 10 years as accountant: 10 x 0.081 x 0.3 = 0.24. Relatedness below the stored related list's cut-off.
    const jobs = [job('2411.1', '2010-11', '2020-11'), job('2513.5', '2023-11')];
    expect(occupationYears(jobs, '2513.5', TODAY)).toEqual({ years: 3.0, related: 0.2 });
  });

  it('caps the credit at the main years', () => {
    // 14 months data scientist is 1.0 year in half years; 6 years data analyst would give 6 x 0.84 x 0.3 = 1.5.
    const jobs = [job('2511.2', '2018-09', '2024-09'), job('2511.3', '2025-09')];
    expect(occupationYears(jobs, '2511.3', TODAY)).toEqual({ years: 1.0, related: 1.0 });
  });

  it('rounds main years from dates to half years as in v1', () => {
    // 23 months is 2.0 years, 20 months 1.5.
    expect(occupationYears([job('2513.5', '2024-12')], '2513.5', TODAY).years).toBe(2.0);
    expect(occupationYears([job('2513.5', '2025-03')], '2513.5', TODAY).years).toBe(1.5);
  });

  it('rounds a half like Python: 3 months is 0 years, 9 months 1.0', () => {
    expect(occupationYears([job('2513.5', '2026-08')], '2513.5', TODAY).years).toBe(0);
    expect(occupationYears([job('2513.5', '2026-02')], '2513.5', TODAY).years).toBe(1.0);
  });

  it('counts overlapping jobs of one occupation once', () => {
    const jobs = [
      job('2513.5', '2020-11', '2023-11'),
      job('2513.5', '2022-11', '2024-11'),
      job('2512.3', '2020-11', '2023-11'),
      job('2512.3', '2021-11', '2023-11'),
    ];
    // Web developer: 2020-11 to 2024-11 is 4 years, not 5; the developer jobs union to 3 years: 3 x 0.54 x 0.3.
    expect(occupationYears(jobs, '2513.5', TODAY)).toEqual({ years: 4.0, related: 0.5 });
  });

  it('counts jobs in two occupations at the same time each for their own occupation', () => {
    const jobs = [job('2513.5', '2022-11', '2024-11'), job('2512.3', '2022-11', '2024-11')];
    expect(occupationYears(jobs, '2513.5', TODAY).years).toBe(2.0);
    expect(occupationYears(jobs, '2512.3', TODAY).years).toBe(2.0);
  });

  it('gives nothing for jobs without an occupation or valid dates', () => {
    const jobs = [
      job(null, '2010-01', '2020-01'),
      job('2513.5', 'not a date'),
      job('2513.5', '2024-11', '2023-01'),
      job('2513.5', '2025-11'),
    ];
    expect(occupationYears(jobs, '2513.5', TODAY)).toEqual({ years: 1.0, related: 0.0 });
  });
});

describe('yearsInOccupation and relatedYears', () => {
  const resumeJob = (occupation: string, start: string, end = '', current = false) => ({
    title: 'Role',
    occupation,
    start,
    end,
    current,
    description: '',
  });

  it('count the resume jobs for its occupation', () => {
    const data = {
      Occupation: '2512.3',
      Jobs: [resumeJob('2511.8', '2022-11', '2024-11'), resumeJob('2512.3', '2024-11', '', true)],
    };
    expect(yearsInOccupation(data, TODAY)).toBe(2.0);
    expect(relatedYears(data, TODAY)).toBe(0.2);
  });

  it('ignore a typed-in number and give 0 years for an occupation with no jobs in it', () => {
    const data = { Occupation: '2513.5', YearsExperience: '9' };
    expect(yearsInOccupation(data, TODAY)).toBe(0);
    expect(relatedYears(data, TODAY)).toBe(0);
  });

  it('are null until an occupation from the catalogue is chosen', () => {
    expect(yearsInOccupation({ Occupation: '9999.9' }, TODAY)).toBeNull();
    expect(yearsInOccupation({ Industry: 'QA' }, TODAY)).toBeNull();
    expect(relatedYears({}, TODAY)).toBeNull();
  });

  it('keep a legacy job: its old field becomes legacyField and its months count toward nothing', () => {
    const jobs = cleanResumeJobs([
      { title: 'Tester', field: 'QA', start: '2022-01', end: '', current: true },
    ]);
    expect(jobs).toEqual([
      {
        title: 'Tester',
        occupation: '',
        legacyField: 'QA',
        start: '2022-01',
        end: '',
        current: true,
        description: '',
      },
    ]);
    expect(yearsInOccupation({ Occupation: '2513.5', Jobs: jobs }, TODAY)).toBe(0);
  });
});
