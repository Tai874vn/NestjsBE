import { yearsInField } from './resume-career';

const today = new Date('2026-11-16T00:00:00Z');
const job = (field: string, start: string, end = '', current = false) => ({ title: 'Role', field, start, end, current, description: '' });

describe('yearsInField', () => {
  it('counts only the months of jobs in the chosen field, overlaps once', () => {
    const data = {
      Industry: 'Software development',
      Jobs: [
        job('Software development', '2020-01', '2022-01'),
        job('Software development', '2021-06', '', true),
        job('Finance', '2015-01', '2019-12'),
      ],
    };
    expect(yearsInField(data, today)).toBe(6.8);
  });

  it('ignores a typed-in number and gives 0 years for a field with no jobs in it', () => {
    expect(yearsInField({ Industry: 'QA', YearsExperience: '9' }, today)).toBe(0);
  });

  it('is null until a field from the list is chosen', () => {
    expect(yearsInField({ Industry: 'Rocket surgery', YearsExperience: '3' }, today)).toBeNull();
    expect(yearsInField({}, today)).toBeNull();
  });
});
