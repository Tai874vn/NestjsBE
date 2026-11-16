import { resumeEducation } from './resume-career';

describe('resumeEducation', () => {
  it('returns the degree and a valid field-of-study code', () => {
    expect(resumeEducation({ Degree: 'Bachelor', FieldOfStudy: '0613' })).toEqual({
      degree: 'Bachelor',
      fieldOfStudy: '0613',
    });
    expect(resumeEducation({ Degree: 'Master or higher', FieldOfStudy: 'computing' })).toEqual({
      degree: 'Master or higher',
      fieldOfStudy: null,
    });
  });

  it('returns null without a stated degree', () => {
    expect(resumeEducation({ Degree: 'Not stated', FieldOfStudy: '0613' })).toBeNull();
    expect(resumeEducation({})).toBeNull();
    expect(resumeEducation(null)).toBeNull();
  });
});
