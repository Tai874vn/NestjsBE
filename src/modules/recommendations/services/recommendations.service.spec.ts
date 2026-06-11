import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Role } from '../../../common/constants/roles';
import { RecommendationsService } from './recommendations.service';

const redisFreePrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  job: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
};

const aiClient = {
  matchJobs: jest.fn(),
  matchCandidates: jest.fn(),
};

const scoring = {
  scoreJobMatch: jest.fn(),
  scoreCandidateMatch: jest.fn(),
};

function createService() {
  return new RecommendationsService(redisFreePrisma as any, aiClient as any, scoring as any);
}

describe('RecommendationsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('recommends jobs by sending current user resume and candidate jobs to AI service', async () => {
    redisFreePrisma.user.findUnique.mockResolvedValue({
      id: 1,
      headline: 'Backend Engineer',
      bio: 'Builds APIs',
      location: 'Remote',
      skill: '["Python"]',
      profileSkills: [{ name: 'FastAPI', level: 'advanced' }],
      resume: { data: { Summary: 'Python backend developer', Skills: 'Python, FastAPI' } },
    });
    redisFreePrisma.job.findMany.mockResolvedValue([
      {
        id: 10,
        title: 'API Developer',
        description: 'Python FastAPI project',
        shortDescription: 'Backend API',
        price: 100,
        subcategory: { name: 'Backend', category: { name: 'Software' } },
        user: { id: 2, name: 'Client', avatar: null },
      },
    ]);
    aiClient.matchJobs.mockResolvedValue({
      matches: [{ id: '10', score: 0.82, rank: 1 }],
      model: 'model',
      elapsed_ms: 10,
    });
    scoring.scoreJobMatch.mockReturnValue({
      aiScore: 0.82,
      finalScore: 0.91,
      label: 'high_match',
      skillScore: 1,
      seniorityScore: 0,
      categoryScore: 1,
    });

    const result = await createService().recommendJobsForUser(1, { topK: 5, poolSize: 25 });

    expect(aiClient.matchJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        resume: expect.objectContaining({
          skills: ['FastAPI', 'Python'],
        }),
        jobs: [
          expect.objectContaining({
            id: 10,
            job_title: 'API Developer',
            required_skills: ['FastAPI', 'Python'],
          }),
        ],
        top_k: 5,
      }),
    );
    expect(result.content.data[0]).toMatchObject({
      id: 10,
      recommendation: {
        aiScore: 0.82,
        finalScore: 0.91,
        label: 'high_match',
        rank: 1,
      },
    });
  });

  it('throws service unavailable when AI service cannot be reached', async () => {
    redisFreePrisma.user.findUnique.mockResolvedValue({
      id: 1,
      profileSkills: [],
      resume: { data: { Summary: 'Backend developer' } },
    });
    redisFreePrisma.job.findMany.mockResolvedValue([{ id: 10, title: 'API Developer' }]);
    aiClient.matchJobs.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(createService().recommendJobsForUser(1, { topK: 5, poolSize: 25 })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('only lets job owner or admin request candidate recommendations', async () => {
    redisFreePrisma.job.findUnique.mockResolvedValue({ id: 10, creatorId: 99 });

    await expect(createService().recommendCandidatesForJob(10, 1, Role.USER, { topK: 5, poolSize: 25 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    redisFreePrisma.job.findUnique.mockResolvedValue(null);
    await expect(createService().recommendCandidatesForJob(404, 1, Role.ADMIN, { topK: 5, poolSize: 25 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
