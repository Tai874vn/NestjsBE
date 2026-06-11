import { RecommendationScoringService } from './recommendation-scoring.service';

describe('RecommendationScoringService', () => {
  let service: RecommendationScoringService;

  beforeEach(() => {
    service = new RecommendationScoringService();
  });

  it('combines AI, skill, seniority, and category scores into a labeled high match', () => {
    const result = service.scoreJobMatch({
      aiScore: 0.8,
      resumeSkills: ['Python', 'FastAPI'],
      resumeText: 'Senior backend engineer with API experience',
      jobText: 'Senior Python FastAPI backend work in Backend category',
      jobCategoryText: 'Backend',
    });

    expect(result.finalScore).toBeCloseTo(0.87, 2);
    expect(result.label).toBe('high_match');
    expect(result.skillScore).toBe(1);
    expect(result.seniorityScore).toBe(1);
    expect(result.categoryScore).toBe(1);
  });

  it('labels weak matches as low match and clamps scores', () => {
    const result = service.scoreJobMatch({
      aiScore: -1.8,
      resumeSkills: ['React'],
      resumeText: 'Junior frontend developer',
      jobText: 'Senior Python backend service',
      jobCategoryText: 'Backend',
    });

    expect(result.aiScore).toBe(0);
    expect(result.finalScore).toBeLessThan(0.75);
    expect(result.label).toBe('low_match');
  });
});
