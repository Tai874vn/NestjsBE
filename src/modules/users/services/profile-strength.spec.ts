import { profileStrength } from './profile-strength';

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
  Industry: 'Software development',
  YearsExperience: '4',
  Degree: 'Bachelor',
  FieldOfStudy: '0613',
  Jobs: [
    { title: 'Developer', field: 'Software development', start: '2021-01', end: '', current: true, description: '' },
  ],
};

describe('profileStrength', () => {
  it('reaches 100 for a complete candidate without website, certifications, or cover', () => {
    expect(profileStrength({ ...fullCandidate, resumeData: fullResume })).toBe(100);
  });

  it('weights the resume field and years most', () => {
    expect(profileStrength({ ...fullCandidate, resumeData: null })).toBe(60);
  });

  it('gives half the skills credit below five skills', () => {
    expect(profileStrength({ ...fullCandidate, skills: 2, resumeData: fullResume })).toBe(93);
  });

  it('counts years from dated jobs in the main field, and accepts "Not stated" education', () => {
    const { YearsExperience: _years, ...withoutYears } = fullResume;
    expect(profileStrength({ ...fullCandidate, resumeData: { ...withoutYears, Degree: 'Not stated', FieldOfStudy: '' } })).toBe(100);
    expect(profileStrength({ ...fullCandidate, resumeData: { ...fullResume, Industry: 'Rocket surgery' } })).toBe(75);
  });

  it('scores recruiters on identity and a hiring post', () => {
    const recruiter = { role: 'employer', headline: 'Hiring', bio: 'We build tools.', location: 'Hanoi', website: 'https://acme.example', avatar: '/logo.png', skills: 0, portfolio: 0 };
    expect(profileStrength({ ...recruiter, hiringPosts: 1 })).toBe(100);
    expect(profileStrength(recruiter)).toBe(80);
    expect(profileStrength({ role: 'employer', skills: 0, portfolio: 0 })).toBe(0);
  });
});
