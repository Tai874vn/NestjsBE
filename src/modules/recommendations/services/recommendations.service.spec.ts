import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Role } from '../../../common/constants/roles';
import { RecommendationPayloadMapperService } from './recommendation-payload-mapper.service';
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

const quota = {
  getQuotaForUser: jest.fn(),
  ensureAvailable: jest.fn(),
  consume: jest.fn(),
};

const cache = {
  ttlSeconds: 300,
  getJobs: jest.fn(),
  setJobs: jest.fn(),
  getCandidates: jest.fn(),
  setCandidates: jest.fn(),
};

const timer = {
  time: jest.fn((_step: string, callback: () => Promise<unknown>) => callback()),
  annotate: jest.fn(),
  end: jest.fn(),
  fail: jest.fn(),
};

const observability = {
  startOperation: jest.fn(() => timer),
};

const payloadMapper = new RecommendationPayloadMapperService();

function createService() {
  return new RecommendationsService(
    redisFreePrisma as any,
    aiClient as any,
    scoring as any,
    payloadMapper,
    quota as any,
    cache as any,
    observability as any,
  );
}

describe('RecommendationsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    quota.getQuotaForUser.mockResolvedValue({ limit: 5, used: 0, remaining: 5, resetAt: 'tomorrow' });
    quota.ensureAvailable.mockResolvedValue(undefined);
    quota.consume.mockResolvedValue({ limit: 5, used: 1, remaining: 4, resetAt: 'tomorrow' });
    cache.getJobs.mockResolvedValue(undefined);
    cache.getCandidates.mockResolvedValue(undefined);
    cache.setJobs.mockResolvedValue(undefined);
    cache.setCandidates.mockResolvedValue(undefined);
    timer.time.mockImplementation((_step: string, callback: () => Promise<unknown>) => callback());
    observability.startOperation.mockReturnValue(timer);
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
    expect(result.content.quota).toMatchObject({ limit: 5, used: 1, remaining: 4 });
    expect(cache.setJobs).toHaveBeenCalledWith(
      1,
      5,
      25,
      expect.objectContaining({ data: expect.any(Array), model: 'model', elapsedMs: 10 }),
    );
  });

  it('redacts direct contact details before sending resumes to the AI service', async () => {
    redisFreePrisma.user.findUnique.mockResolvedValue({
      id: 1,
      headline: null,
      bio: null,
      location: 'Remote',
      skill: null,
      profileSkills: [],
      resume: {
        data: {
          Name: 'Private Candidate',
          Email: 'candidate@example.com',
          Phone: '+1 415 555 0100',
          Category: 'Backend Engineer',
          Summary: 'Reach me at candidate@example.com',
          Skills: 'Node.js',
          Text: 'Phone +1 415 555 0100 and email candidate@example.com',
        },
      },
    });
    redisFreePrisma.job.findMany.mockResolvedValue([
      { id: 10, title: 'API Developer', description: 'Node.js API' },
    ]);
    aiClient.matchJobs.mockResolvedValue({
      matches: [],
      model: 'model',
      elapsed_ms: 8,
    });

    await createService().recommendJobsForUser(1, { topK: 5, poolSize: 25 });

    const payload = aiClient.matchJobs.mock.calls[0][0];
    expect(payload.resume.data).not.toHaveProperty('Name');
    expect(payload.resume.data).not.toHaveProperty('Email');
    expect(payload.resume.data).not.toHaveProperty('Phone');
    expect(payload.resume.title).toBe('Backend Engineer');
    expect(payload.resume.text).not.toContain('candidate@example.com');
    expect(payload.resume.text).not.toContain('+1 415 555 0100');
    expect(payload.resume.text).toContain('[redacted-email]');
    expect(payload.resume.text).toContain('[redacted-phone]');
  });

  it('returns quota without calling the AI service', async () => {
    quota.getQuotaForUser.mockResolvedValue({ limit: 5, used: 2, remaining: 3, resetAt: 'tomorrow' });

    const result = await createService().getQuotaForUser(1);

    expect(aiClient.matchJobs).not.toHaveBeenCalled();
    expect(result.content).toMatchObject({ limit: 5, used: 2, remaining: 3 });
  });

  it('does not consume quota when AI returns no displayable job matches', async () => {
    redisFreePrisma.user.findUnique.mockResolvedValue({
      id: 1,
      profileSkills: [],
      resume: { data: { Summary: 'Backend developer' } },
    });
    redisFreePrisma.job.findMany.mockResolvedValue([{ id: 10, title: 'API Developer' }]);
    aiClient.matchJobs.mockResolvedValue({
      matches: [],
      model: 'model',
      elapsed_ms: 8,
    });

    const result = await createService().recommendJobsForUser(1, { topK: 5, poolSize: 25 });

    expect(quota.consume).not.toHaveBeenCalled();
    expect(result.content.data).toEqual([]);
    expect(result.content.quota).toMatchObject({ limit: 5, used: 0, remaining: 5 });
  });

  it('returns cached job recommendations without consuming quota or calling AI', async () => {
    cache.getJobs.mockResolvedValue({
      data: [{ id: 10, recommendation: { finalScore: 0.9 } }],
      model: 'cached-model',
      elapsedMs: 15,
      generatedAt: '2026-07-11T00:00:00.000Z',
    });

    const result = await createService().recommendJobsForUser(1, { topK: 5, poolSize: 25 });

    expect(quota.ensureAvailable).not.toHaveBeenCalled();
    expect(quota.consume).not.toHaveBeenCalled();
    expect(aiClient.matchJobs).not.toHaveBeenCalled();
    expect(result.content.cache).toEqual({ hit: true, ttlSeconds: 300 });
    expect(result.content.data).toEqual([{ id: 10, recommendation: { finalScore: 0.9 } }]);
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

  it('only lets employer job owners or admins request candidate recommendations', async () => {
    redisFreePrisma.job.findUnique.mockResolvedValue({ id: 10, creatorId: 1 });

    await expect(createService().recommendCandidatesForJob(10, 1, Role.USER, { topK: 5, poolSize: 25 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    redisFreePrisma.job.findUnique.mockResolvedValue({ id: 10, creatorId: 99 });

    await expect(createService().recommendCandidatesForJob(10, 1, Role.EMPLOYER, { topK: 5, poolSize: 25 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    redisFreePrisma.job.findUnique.mockResolvedValue(null);
    await expect(createService().recommendCandidatesForJob(404, 1, Role.ADMIN, { topK: 5, poolSize: 25 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
