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
