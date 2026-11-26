import { RecommendationScoringService } from '../recommendation-scoring.service';

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
    expect(result.requiredSkills).toEqual(['Python', 'FastAPI']);
    expect(result.missingSkills).toEqual([]);
  });

  it('returns missing required skills and improvement tips', () => {
    const result = service.scoreJobMatch({
      aiScore: 0.74,
      resumeSkills: ['Python', 'FastAPI'],
      resumeText: 'Backend developer using Python and FastAPI',
      jobText: 'Need Python FastAPI developer with Docker, PostgreSQL, and AWS experience',
      jobCategoryText: 'Backend',
    });

    expect(result.requiredSkills).toEqual(['Python', 'FastAPI', 'PostgreSQL', 'Docker', 'AWS']);
    expect(result.matchedSkills).toEqual(['Python', 'FastAPI']);
    expect(result.missingSkills).toEqual(['PostgreSQL', 'Docker', 'AWS']);
    expect(result.improvementTips[0]).toContain('PostgreSQL, Docker, AWS');
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

  it('can format AI-only classifier scores without backend reranking', () => {
    const result = service.scoreAiOnlyMatch(0.86);

    expect(result).toMatchObject({
      aiScore: 0.86,
      finalScore: 0.86,
      label: 'high_match',
      skillScore: 0,
      seniorityScore: 0,
      categoryScore: 0,
      requiredSkills: [],
      matchedSkills: [],
      missingSkills: [],
      improvementTips: [],
    });
  });

  it('keeps recruiter classifier match and no-match decisions from AI metadata', () => {
    const match = service.scoreRecruiterClassifierMatch(0.42, {
      matching: true,
      match_label: 'match',
      threshold: 0.5,
    });
    const noMatch = service.scoreRecruiterClassifierMatch(0.91, {
      matching: false,
      match_label: 'no_match',
      threshold: 0.5,
    });

    expect(match).toMatchObject({
      aiScore: 0.42,
      finalScore: 0.42,
      isMatch: true,
      matchLabel: 'match',
      source: 'classifier',
      threshold: 0.5,
    });
    expect(noMatch).toMatchObject({
      aiScore: 0.91,
      finalScore: 0.91,
      label: 'low_match',
      isMatch: false,
      matchLabel: 'no_match',
      source: 'classifier',
      threshold: 0.5,
    });
  });
});
