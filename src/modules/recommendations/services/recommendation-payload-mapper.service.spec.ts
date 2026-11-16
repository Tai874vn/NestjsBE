import { RecommendationPayloadMapperService } from './recommendation-payload-mapper.service';

describe('RecommendationPayloadMapperService hiring post payload', () => {
  const post = {
    id: 4,
    recruiterId: 2,
    title: 'Platform Engineer',
    description: 'Run our cloud platform and on-call rotation',
    requirements: null,
    careerField: 'Software development',
    yearsRequired: 5,
    skills: ['Kubernetes', 'Terraform'],
    updatedAt: new Date('2026-11-15T00:00:00.000Z'),
  };

  it('sends the recruiter-set field, years and skills to the AI service', () => {
    const payload = new RecommendationPayloadMapperService().buildHiringPostPayload(post);

    expect(payload).toMatchObject({
      career_field: 'Software development',
      years_required: 5,
      skills: ['Kubernetes', 'Terraform'],
      required_skills: ['Kubernetes', 'Terraform'],
    });
  });
});

describe('RecommendationPayloadMapperService resume payload', () => {
  it('sends the occupation, its title as industry, and the years counted per occupation', () => {
    const payload = new RecommendationPayloadMapperService().buildResumePayload({
      id: 7,
      resume: {
        data: {
          Occupation: '2513.5',
          Jobs: [{ title: 'Web developer', occupation: '2513.5', start: '2020-01', end: '2022-01', current: false }],
        },
      },
    });
    expect(payload).toMatchObject({
      occupation: '2513.5',
      industry: 'web developer',
      years_experience: '2',
      years_in_occupation: 2,
      related_years: 0,
    });
  });

  it('sends no occupation or years for a resume from before occupations', () => {
    const payload = new RecommendationPayloadMapperService().buildResumePayload({
      id: 7,
      resume: { data: { Occupation: '', LegacyField: 'QA' } },
    });
    expect(payload).toMatchObject({ occupation: null, industry: null, years_experience: undefined });
  });
});
