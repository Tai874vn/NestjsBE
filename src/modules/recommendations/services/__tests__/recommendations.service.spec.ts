import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Role } from '../../../../common/constants/roles';
import { ObservabilityService } from '../../../../common/observability/observability.service';
import { PrismaService } from '../../../../prisma.service';
import { AiRecommendationClient } from '../ai-recommendation.client';
import { RecommendationCacheService } from '../recommendation-cache.service';
import { RecommendationDataLoaderService } from '../recommendation-data-loader.service';
import { RecommendationFingerprintService } from '../recommendation-fingerprint.service';
import { RecommendationPayloadMapperService } from '../recommendation-payload-mapper.service';
import { RecommendationQuotaService } from '../recommendation-quota.service';
import { RecommendationScoringService } from '../recommendation-scoring.service';
import { RecommendationSnapshotService } from '../recommendation-snapshot.service';
import { RecommendationsService } from '../recommendations.service';

const redisFreePrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  job: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  hiringPost: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
};

const aiClient = {
  matchJobs: jest.fn(),
  matchCandidates: jest.fn(),
  matchRecruiterCandidates: jest.fn(),
};

const scoring = {
  scoreJobMatch: jest.fn(),
  scoreCandidateMatch: jest.fn(),
  scoreAiOnlyMatch: jest.fn(),
  scoreRecruiterClassifierMatch: jest.fn(),
};

const quota = {
  getQuotaForUser: jest.fn(),
  ensureAvailable: jest.fn(),
  consume: jest.fn(),
  reserve: jest.fn(),
  refund: jest.fn(),
};

const cache = {
  ttlSeconds: 300,
  getJobs: jest.fn(),
  setJobs: jest.fn(),
  getCandidates: jest.fn(),
  setCandidates: jest.fn(),
  getHiringPostCandidates: jest.fn(),
  setHiringPostCandidates: jest.fn(),
  acquireRunLock: jest.fn(),
  releaseRunLock: jest.fn(),
};

const fingerprints = {
  jobs: jest.fn(),
  hiringPostCandidates: jest.fn(),
};

const snapshots = {
  getJobs: jest.fn(),
  saveJobs: jest.fn(),
  getCandidates: jest.fn(),
  saveCandidates: jest.fn(),
  getHiringPostCandidates: jest.fn(),
  saveHiringPostCandidates: jest.fn(),
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
  const dataLoader = new RecommendationDataLoaderService(
    redisFreePrisma as unknown as PrismaService,
  );
  return new RecommendationsService(
    aiClient as unknown as AiRecommendationClient,
    scoring as unknown as RecommendationScoringService,
    payloadMapper,
    dataLoader,
    fingerprints as unknown as RecommendationFingerprintService,
    quota as unknown as RecommendationQuotaService,
    cache as unknown as RecommendationCacheService,
    snapshots as unknown as RecommendationSnapshotService,
    observability as unknown as ObservabilityService,
  );
}

describe('RecommendationsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    quota.getQuotaForUser.mockResolvedValue({ limit: 5, used: 0, remaining: 5, resetAt: 'tomorrow' });
    quota.ensureAvailable.mockResolvedValue(undefined);
    quota.consume.mockResolvedValue({ limit: 5, used: 1, remaining: 4, resetAt: 'tomorrow' });
    quota.reserve.mockResolvedValue({ limit: 5, used: 1, remaining: 4, resetAt: 'tomorrow' });
    quota.refund.mockResolvedValue({ limit: 5, used: 0, remaining: 5, resetAt: 'tomorrow' });
    cache.getJobs.mockResolvedValue(undefined);
    cache.getCandidates.mockResolvedValue(undefined);
    cache.getHiringPostCandidates.mockResolvedValue(undefined);
    cache.setJobs.mockResolvedValue(undefined);
    cache.setCandidates.mockResolvedValue(undefined);
    cache.setHiringPostCandidates.mockResolvedValue(undefined);
    cache.acquireRunLock.mockResolvedValue('lock-token');
    cache.releaseRunLock.mockResolvedValue(undefined);
    fingerprints.jobs.mockResolvedValue('jobs-fingerprint');
    fingerprints.hiringPostCandidates.mockResolvedValue(
      'candidates-fingerprint',
    );
    snapshots.getJobs.mockResolvedValue(undefined);
    snapshots.getCandidates.mockResolvedValue(undefined);
    snapshots.getHiringPostCandidates.mockResolvedValue(undefined);
    snapshots.saveJobs.mockResolvedValue(undefined);
    snapshots.saveCandidates.mockResolvedValue(undefined);
    snapshots.saveHiringPostCandidates.mockResolvedValue(undefined);
    timer.time.mockImplementation((_step: string, callback: () => Promise<unknown>) => callback());
    observability.startOperation.mockReturnValue(timer);
  });

  it('recommends open hiring posts by sending the candidate resume and the posts to the AI service', async () => {
    redisFreePrisma.user.findUnique.mockResolvedValue({
      id: 1,
      headline: 'Backend Engineer',
      bio: 'Builds APIs',
      location: 'Remote',
      skill: '["Python"]',
      profileSkills: [{ name: 'FastAPI', level: 'advanced' }],
      resume: { data: { Summary: 'Python backend developer', Skills: 'Python, FastAPI' } },
    });
    redisFreePrisma.hiringPost.findMany.mockResolvedValue([
      {
        id: 10,
        recruiterId: 2,
        title: 'API Developer',
        description: 'Python FastAPI project',
        requirements: null,
        occupationCode: '2512.3',
        yearsRequired: 2,
        skills: [],
        updatedAt: new Date('2026-11-15T00:00:00.000Z'),
        recruiter: { id: 2, name: 'Recruiter', avatar: null, headline: null },
        _count: { applications: 3 },
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
    // Candidates are matched to open hiring posts, shown with their applicant count.
    expect(result.content.data[0]).toMatchObject({
      id: 10,
      occupationCode: '2512.3',
      // The catalogue title, as hiring-post cards carry it.
      occupationTitle: 'software developer',
      applicationCount: 3,
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
      'jobs-fingerprint',
      expect.objectContaining({ data: expect.any(Array), model: 'model', elapsedMs: 10 }),
    );
    expect(snapshots.saveJobs).toHaveBeenCalledWith(
      1,
      5,
      25,
      'jobs-fingerprint',
      expect.objectContaining({ data: expect.any(Array), model: 'model', elapsedMs: 10 }),
    );
    expect(snapshots.saveJobs.mock.invocationCallOrder[0]).toBeLessThan(
      cache.setJobs.mock.invocationCallOrder[0],
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
    redisFreePrisma.hiringPost.findMany.mockResolvedValue([
      { id: 10, title: 'API Developer', description: 'Node.js API', skills: [], _count: { applications: 0 } },
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

  it('refunds quota when AI returns no displayable job matches', async () => {
    redisFreePrisma.user.findUnique.mockResolvedValue({
      id: 1,
      profileSkills: [],
      resume: { data: { Summary: 'Backend developer' } },
    });
    redisFreePrisma.hiringPost.findMany.mockResolvedValue([{ id: 10, title: 'API Developer', description: '', skills: [], _count: { applications: 0 } }]);
    aiClient.matchJobs.mockResolvedValue({
      matches: [],
      model: 'model',
      elapsed_ms: 8,
    });

    const result = await createService().recommendJobsForUser(1, { topK: 5, poolSize: 25 });

    expect(quota.reserve).toHaveBeenCalledWith(1, undefined);
    expect(quota.refund).toHaveBeenCalledWith(1, undefined);
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
    expect(quota.reserve).not.toHaveBeenCalled();
    expect(aiClient.matchJobs).not.toHaveBeenCalled();
    expect(result.content.cache).toEqual({ hit: true, ttlSeconds: 300, source: 'redis' });
    expect(result.content.data).toEqual([{ id: 10, recommendation: { finalScore: 0.9 } }]);
  });

  it('returns saved job recommendations without consuming quota or calling AI when Redis misses', async () => {
    snapshots.getJobs.mockResolvedValue({
      data: [{ id: 10, recommendation: { finalScore: 0.9 } }],
      model: 'saved-model',
      elapsedMs: 25,
      generatedAt: '2026-07-16T00:00:00.000Z',
    });

    const result = await createService().recommendJobsForUser(1, { topK: 5, poolSize: 25 });

    expect(cache.getJobs).toHaveBeenCalledWith(1, 5, 25, 'jobs-fingerprint');
    expect(snapshots.getJobs).toHaveBeenCalledWith(1, 5, 25, 'jobs-fingerprint');
    expect(cache.setJobs).toHaveBeenCalledWith(
      1,
      5,
      25,
      'jobs-fingerprint',
      expect.objectContaining({ model: 'saved-model' }),
    );
    expect(quota.ensureAvailable).not.toHaveBeenCalled();
    expect(quota.consume).not.toHaveBeenCalled();
    expect(quota.reserve).not.toHaveBeenCalled();
    expect(redisFreePrisma.user.findUnique).not.toHaveBeenCalled();
    expect(aiClient.matchJobs).not.toHaveBeenCalled();
    expect(result.content.cache).toEqual({ hit: true, ttlSeconds: 300, source: 'database' });
  });

  it('returns a cache miss without running AI or consuming quota when job recommendations are cache-only', async () => {
    const result = await createService().recommendJobsForUser(1, {
      topK: 5,
      poolSize: 25,
      cacheOnly: true,
    });

    expect(cache.getJobs).toHaveBeenCalledWith(1, 5, 25, 'jobs-fingerprint');
    expect(quota.getQuotaForUser).toHaveBeenCalledWith(1, undefined);
    expect(quota.ensureAvailable).not.toHaveBeenCalled();
    expect(quota.consume).not.toHaveBeenCalled();
    expect(quota.reserve).not.toHaveBeenCalled();
    expect(redisFreePrisma.user.findUnique).not.toHaveBeenCalled();
    expect(redisFreePrisma.hiringPost.findMany).not.toHaveBeenCalled();
    expect(aiClient.matchJobs).not.toHaveBeenCalled();
    expect(result.content).toMatchObject({
      data: [],
      cache: { hit: false, ttlSeconds: 300 },
    });
  });

  it('bypasses saved job recommendations when force refresh is requested', async () => {
    snapshots.getJobs.mockResolvedValue({
      data: [{ id: 10, recommendation: { finalScore: 0.9 } }],
      model: 'saved-model',
      elapsedMs: 25,
      generatedAt: '2026-07-16T00:00:00.000Z',
    });
    redisFreePrisma.user.findUnique.mockResolvedValue({
      id: 1,
      profileSkills: [],
      resume: { data: { Summary: 'Backend developer' } },
    });
    redisFreePrisma.hiringPost.findMany.mockResolvedValue([{ id: 10, title: 'API Developer', description: '', skills: [], _count: { applications: 0 } }]);
    aiClient.matchJobs.mockResolvedValue({
      matches: [],
      model: 'fresh-model',
      elapsed_ms: 8,
    });

    await createService().recommendJobsForUser(1, { topK: 5, poolSize: 25, forceRefresh: true });

    expect(cache.getJobs).not.toHaveBeenCalled();
    expect(snapshots.getJobs).not.toHaveBeenCalled();
    expect(aiClient.matchJobs).toHaveBeenCalled();
    expect(snapshots.saveJobs).toHaveBeenCalledWith(
      1,
      5,
      25,
      'jobs-fingerprint',
      expect.objectContaining({ model: 'fresh-model' }),
    );
  });

  it('throws service unavailable when AI service cannot be reached', async () => {
    redisFreePrisma.user.findUnique.mockResolvedValue({
      id: 1,
      profileSkills: [],
      resume: { data: { Summary: 'Backend developer' } },
    });
    redisFreePrisma.hiringPost.findMany.mockResolvedValue([{ id: 10, title: 'API Developer', description: '', skills: [], _count: { applications: 0 } }]);
    aiClient.matchJobs.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(createService().recommendJobsForUser(1, { topK: 5, poolSize: 25 })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(quota.refund).toHaveBeenCalledWith(1, undefined);
  });

  it('does not turn a 400 BadRequestException from the AI client into a 503', async () => {
    redisFreePrisma.user.findUnique.mockResolvedValue({
      id: 1,
      profileSkills: [],
      resume: { data: { Summary: 'Backend developer' } },
    });
    redisFreePrisma.hiringPost.findMany.mockResolvedValue([{ id: 10, title: 'API Developer', description: '', skills: [], _count: { applications: 0 } }]);
    aiClient.matchJobs.mockRejectedValue(new BadRequestException('Invalid payload'));

    await expect(createService().recommendJobsForUser(1, { topK: 5, poolSize: 25 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(quota.refund).toHaveBeenCalledWith(1, undefined);
  });

  it('recommends candidates from a recruiter hiring post', async () => {
    redisFreePrisma.hiringPost.findUnique.mockResolvedValue({
      id: 20,
      recruiterId: 2,
      title: 'Security Analyst',
      description: 'Need SOC analyst with SIEM and Incident Response experience',
      requirements: 'SIEM, Incident Response',
      location: 'Remote',
      employmentType: 'Full-time',
      salaryMin: 50000,
      salaryMax: 70000,
    });
    redisFreePrisma.user.findMany.mockResolvedValue([
      {
        id: 7,
        name: 'Mina Candidate',
        avatar: null,
        headline: 'SOC Analyst',
        bio: 'Splunk and incident response work',
        location: 'Remote',
        skill: null,
        profileSkills: [{ name: 'Splunk', level: 'advanced' }],
        resume: { data: { Summary: 'SOC analyst', Skills: 'Splunk, Incident Response' } },
      },
    ]);
    aiClient.matchRecruiterCandidates.mockResolvedValue({
      matches: [
        {
          id: '7',
          score: 0.86,
          rank: 1,
          metadata: {
            matching: true,
            match_label: 'match',
            threshold: 0.5,
          },
        },
      ],
      model: 'model',
      elapsed_ms: 12,
    });
    scoring.scoreRecruiterClassifierMatch.mockReturnValue({
      aiScore: 0.86,
      finalScore: 0.86,
      label: 'high_match',
      isMatch: true,
      matchLabel: 'match',
      threshold: 0.5,
      source: 'classifier',
      skillScore: 0,
      seniorityScore: 0,
      categoryScore: 0,
      requiredSkills: [],
      matchedSkills: [],
      missingSkills: [],
      improvementTips: [],
    });

    const result = await createService().recommendCandidatesForHiringPost(
      20,
      2,
      Role.EMPLOYER,
      { topK: 5, poolSize: 25 },
    );

    expect(redisFreePrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: Role.USER }),
      }),
    );
    expect(aiClient.matchRecruiterCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({ id: 20, job_title: 'Security Analyst' }),
        candidates: [expect.objectContaining({ id: 7, skills: ['Splunk', 'Incident Response'] })],
        top_k: 5,
      }),
    );
    expect(scoring.scoreRecruiterClassifierMatch).toHaveBeenCalledWith(
      0.86,
      expect.objectContaining({ matching: true, match_label: 'match' }),
    );
    expect(result.content.data[0]).toMatchObject({
      id: 7,
      recommendation: {
        aiScore: 0.86,
        finalScore: 0.86,
        label: 'high_match',
        isMatch: true,
        matchLabel: 'match',
        decision: 'match',
        threshold: 0.5,
        source: 'classifier',
        rank: 1,
        requiredSkills: [],
        matchedSkills: [],
        missingSkills: [],
      },
    });
    expect(snapshots.saveHiringPostCandidates).toHaveBeenCalledWith(
      2,
      20,
      5,
      25,
      'candidates-fingerprint',
      expect.objectContaining({ data: expect.any(Array), model: 'model', elapsedMs: 12 }),
    );
    expect(cache.setHiringPostCandidates).toHaveBeenCalledWith(
      2,
      20,
      5,
      25,
      'candidates-fingerprint',
      expect.objectContaining({ data: expect.any(Array), model: 'model', elapsedMs: 12 }),
    );
  });

  it('only lets employer hiring-post owners or admins request candidate recommendations', async () => {
    await expect(
      createService().recommendCandidatesForHiringPost(20, 1, Role.USER, { topK: 5, poolSize: 25 }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    redisFreePrisma.hiringPost.findUnique.mockResolvedValue({ id: 20, recruiterId: 99 });

    await expect(
      createService().recommendCandidatesForHiringPost(20, 1, Role.EMPLOYER, { topK: 5, poolSize: 25 }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    redisFreePrisma.hiringPost.findUnique.mockResolvedValue(null);

    await expect(
      createService().recommendCandidatesForHiringPost(404, 1, Role.ADMIN, { topK: 5, poolSize: 25 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns a cache miss without running AI or consuming quota when hiring-post candidate recommendations are cache-only', async () => {
    redisFreePrisma.hiringPost.findUnique.mockResolvedValue({
      id: 20,
      recruiterId: 2,
      title: 'Security Analyst',
      description: 'Need SOC analyst',
    });

    const result = await createService().recommendCandidatesForHiringPost(
      20,
      2,
      Role.EMPLOYER,
      { topK: 5, poolSize: 25, cacheOnly: true },
    );

    expect(cache.getHiringPostCandidates).toHaveBeenCalledWith(
      2,
      20,
      5,
      25,
      'candidates-fingerprint',
    );
    expect(quota.getQuotaForUser).toHaveBeenCalledWith(2, 'employer');
    expect(quota.ensureAvailable).not.toHaveBeenCalled();
    expect(quota.consume).not.toHaveBeenCalled();
    expect(quota.reserve).not.toHaveBeenCalled();
    expect(redisFreePrisma.user.findMany).not.toHaveBeenCalled();
    expect(aiClient.matchRecruiterCandidates).not.toHaveBeenCalled();
    expect(result.content).toMatchObject({
      data: [],
      cache: { hit: false, ttlSeconds: 300 },
    });
  });

  it('returns saved hiring-post candidate recommendations without consuming quota or calling AI when Redis misses', async () => {
    redisFreePrisma.hiringPost.findUnique.mockResolvedValue({
      id: 20,
      recruiterId: 2,
      title: 'Security Analyst',
      description: 'Need SOC analyst',
    });
    snapshots.getHiringPostCandidates.mockResolvedValue({
      data: [{ id: 7, recommendation: { finalScore: 0.91 } }],
      model: 'saved-model',
      elapsedMs: 22,
      generatedAt: '2026-07-16T00:00:00.000Z',
    });

    const result = await createService().recommendCandidatesForHiringPost(
      20,
      2,
      Role.EMPLOYER,
      { topK: 5, poolSize: 25 },
    );

    expect(cache.getHiringPostCandidates).toHaveBeenCalledWith(
      2,
      20,
      5,
      25,
      'candidates-fingerprint',
    );
    expect(snapshots.getHiringPostCandidates).toHaveBeenCalledWith(
      2,
      20,
      5,
      25,
      'candidates-fingerprint',
    );
    expect(cache.setHiringPostCandidates).toHaveBeenCalledWith(
      2,
      20,
      5,
      25,
      'candidates-fingerprint',
      expect.objectContaining({ model: 'saved-model' }),
    );
    expect(quota.ensureAvailable).not.toHaveBeenCalled();
    expect(quota.consume).not.toHaveBeenCalled();
    expect(quota.reserve).not.toHaveBeenCalled();
    expect(redisFreePrisma.user.findMany).not.toHaveBeenCalled();
    expect(aiClient.matchRecruiterCandidates).not.toHaveBeenCalled();
    expect(result.content.cache).toEqual({ hit: true, ttlSeconds: 300, source: 'database' });
  });

});
