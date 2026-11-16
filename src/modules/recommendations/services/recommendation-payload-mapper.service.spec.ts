import { RecommendationPayloadMapperService } from './recommendation-payload-mapper.service';

describe('RecommendationPayloadMapperService hiring post payload', () => {
  const post = {
    id: 4,
    recruiterId: 2,
    title: 'Platform Engineer',
    description: 'Run our cloud platform and on-call rotation',
    requirements: null,
    occupationCode: '2512.3',
    yearsRequired: 5,
    skills: ['Kubernetes', 'Terraform'],
    updatedAt: new Date('2026-11-15T00:00:00.000Z'),
  };

  it('sends the recruiter-set occupation, years and skills to the AI service, as job.py reads them', () => {
    const payload = new RecommendationPayloadMapperService().buildHiringPostPayload(post);

    expect(payload).not.toHaveProperty('career_field');
    expect(payload).toMatchObject({
      job_title: 'Platform Engineer',
      title: 'Platform Engineer',
      description: 'Run our cloud platform and on-call rotation',
      occupation: '2512.3',
      years_required: 5,
      skills: ['Kubernetes', 'Terraform'],
      required_skills: ['Kubernetes', 'Terraform'],
    });
  });

  it('sends no occupation for an old post, so the AI matches the job title instead', () => {
    const payload = new RecommendationPayloadMapperService().buildHiringPostPayload({
      ...post,
      occupationCode: null,
    });

    expect(payload.occupation).toBeNull();
    expect(payload.job_title).toBe('Platform Engineer');
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

describe('RecommendationPayloadMapperService cleared level', () => {
  it('sends no seniority for a resume whose level was cleared', () => {
    const payload = new RecommendationPayloadMapperService().buildResumePayload({
      id: 7,
      resume: {
        data: { Occupation: '', LegacyField: 'QA' },
        predictedSeniority: null,
        predictedSeniorityConfidence: null,
      },
    });
    expect(payload.seniority).toBeNull();
    expect(payload.seniority_resume).toBeNull();
    expect(payload.seniority_confidence).toBeNull();
  });
});
