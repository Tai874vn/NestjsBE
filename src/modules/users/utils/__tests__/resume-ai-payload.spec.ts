import { buildResumeSeniorityPayload } from '../resume-ai-payload';
import { resumeCareerProblems } from '../resume-career';

const TODAY = new Date(2026, 10, 16);

describe('buildResumeSeniorityPayload', () => {
  it('sends what features_from_resume reads, with the years counted per occupation', () => {
    const payload = buildResumeSeniorityPayload(
      { headline: 'Developer' },
      {
        Occupation: '2512.3',
        Specialty: 'Back End Developer',
        Summary: 'Led a team of four.',
        Degree: 'Bachelor',
        FieldOfStudy: '0613',
        LegacyField: 'Software development',
        Jobs: [
          { title: 'Business analyst', occupation: '2511.8', legacyField: 'Business analysis', start: '2022-11', end: '2024-11', current: false, description: 'Wrote specs.' },
          { title: 'Developer', occupation: '2512.3', start: '2024-11', end: '', current: true, description: '' },
        ],
      },
      TODAY,
    );

    expect(payload).toEqual({
      occupation: '2512.3',
      specialty: 'Back End Developer',
      role: 'Developer',
      summary: 'Led a team of four.',
      degree: 'Bachelor',
      field_of_study: '0613',
      jobs: [
        { title: 'Business analyst', occupation: '2511.8', start: '2022-11', end: '2024-11', current: false, description: 'Wrote specs.' },
        { title: 'Developer', occupation: '2512.3', start: '2024-11', end: '', current: true, description: '' },
      ],
      years_in_occupation: 2.0,
      related_years: 0.2,
    });
  });

  it('sends 0 years for a fresher with no jobs', () => {
    const payload = buildResumeSeniorityPayload({}, { Occupation: '2513.5' }, TODAY);
    expect(payload).toEqual({ occupation: '2513.5', years_in_occupation: 0, related_years: 0 });
  });

  it('sends no occupation or years for a resume without one, and no old field keys', () => {
    const payload = buildResumeSeniorityPayload({}, { Industry: 'QA', LegacyField: 'QA', Occupation: '' }, TODAY);
    expect(payload).toEqual({});
  });
});

describe('resumeCareerProblems', () => {
  it('accepts a specialty listed under the occupation, and a job without an occupation', () => {
    expect(
      resumeCareerProblems({
        Occupation: '2513.5',
        Specialty: 'Back End Developer',
        Jobs: [{ title: 'Ninja coder', occupation: '', start: '2022-01', end: '', current: true }],
      }),
    ).toEqual([]);
  });
});
