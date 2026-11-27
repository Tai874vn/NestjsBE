import { profileStrength } from '../profile-strength';

// The same cases as the frontend's profile-strength.test.ts, so both sides give one number.
const fullCandidate = {
  role: 'user',
  headline: 'Backend developer',
  bio: 'Builds reliable services.',
  location: 'Hanoi',
  avatar: '/avatar.png',
  skills: 5,
  portfolio: 1,
};
const fullResume = {
  Occupation: '2513.5',
  YearsExperience: '4',
  Degree: 'Bachelor',
  FieldOfStudy: '0613',
  Jobs: [
    { title: 'Developer', occupation: '2513.5', start: '2021-01', end: '', current: true, description: '' },
  ],
};

describe('profileStrength', () => {
  it('reaches 100 for a complete candidate without website, certifications, or cover', () => {
    expect(profileStrength({ ...fullCandidate, resumeData: fullResume })).toBe(100);
  });

  it('weights the resume occupation most', () => {
    expect(profileStrength({ ...fullCandidate, resumeData: null })).toBe(60);
  });

  it('gives half the skills credit below five skills', () => {
    expect(profileStrength({ ...fullCandidate, skills: 2, resumeData: fullResume })).toBe(93);
  });

  it('counts years from dated jobs in the occupation, and accepts "Not stated" education', () => {
    const withoutYears: Record<string, unknown> = { ...fullResume };
    delete withoutYears.YearsExperience;
    expect(profileStrength({ ...fullCandidate, resumeData: { ...withoutYears, Degree: 'Not stated', FieldOfStudy: '' } })).toBe(100);
    // A degree without a field of study is complete education: the field is no longer asked.
    expect(profileStrength({ ...fullCandidate, resumeData: { ...fullResume, Degree: 'Bachelor', FieldOfStudy: '' } })).toBe(100);
    expect(profileStrength({ ...fullCandidate, resumeData: { ...fullResume, Occupation: '9999.9' } })).toBe(75);
    // A resume saved before occupations (old 37-field Industry) scores without crashing; it lacks the occupation (25) and education (5).
    const legacy = { LegacyField: 'Software development', Occupation: '', Jobs: [{ title: 'Developer', legacyField: 'Software development', start: '2021-01', end: '', current: true }] };
    expect(profileStrength({ ...fullCandidate, resumeData: legacy })).toBe(70);
    expect(profileStrength({ ...fullCandidate, resumeData: { Industry: 'QA', Jobs: [{ title: 'Tester', field: 'QA', start: '2021-01', current: true }] } })).toBe(70);
  });

  it('scores recruiters on identity and a hiring post', () => {
    const recruiter = { role: 'employer', headline: 'Hiring', bio: 'We build tools.', location: 'Hanoi', website: 'https://acme.example', avatar: '/logo.png', skills: 0, portfolio: 0 };
    expect(profileStrength({ ...recruiter, hiringPosts: 1 })).toBe(100);
    expect(profileStrength(recruiter)).toBe(80);
    expect(profileStrength({ role: 'employer', skills: 0, portfolio: 0 })).toBe(0);
  });
});
