import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRecommendationClient } from './ai-recommendation.client';

describe('AiRecommendationClient', () => {
  const configValues: Record<string, string> = {
    AI_SERVICE_URL: 'http://127.0.0.1:8001/',
    AI_SERVICE_API_KEY: 'test-service-key-with-more-than-32-chars',
    AI_SERVICE_TIMEOUT_MS: '10000',
  };

  const configService = {
    getOrThrow: jest.fn((key: string) => configValues[key]),
    get: jest.fn((key: string) => configValues[key]),
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ matches: [], model: 'test-model', elapsed_ms: 1 }),
    } as Response);
  });

  it('asks the skill search to rank by the occupation, the parameter the AI reads', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ skills: [] }),
    } as Response);
    const client = new AiRecommendationClient(configService as any);

    await client.searchSkills('react', '2513.5', 5);
    await client.searchSkills('react');

    const urls = (global.fetch as jest.Mock).mock.calls.map(
      ([url]) => url as string,
    );
    expect(urls[0]).toBe(
      'http://127.0.0.1:8001/api/v1/skills/search?q=react&limit=5&occupation=2513.5',
    );
    expect(urls[1]).toBe(
      'http://127.0.0.1:8001/api/v1/skills/search?q=react&limit=10',
    );
  });

  it('sends the shared AI service key on match requests', async () => {
    const client = new AiRecommendationClient(configService as any);
    const payload = {
      job: { id: 7, job_title: 'Security Analyst' },
      candidates: [{ id: 2, text: 'SOC analyst resume' }],
      top_k: 5,
    };

    await client.matchCandidates(payload);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8001/api/v1/match/candidates',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Service-Key': configValues.AI_SERVICE_API_KEY,
        },
        body: JSON.stringify(payload),
      }),
    );
  });

  it('calls the recruiter classifier endpoint for recruiter candidate matching', async () => {
    const client = new AiRecommendationClient(configService as any);
    const payload = {
      job: { id: 7, job_title: 'Security Analyst' },
      candidates: [{ id: 2, role: 'SOC analyst' }],
      top_k: 5,
    };

    await client.matchRecruiterCandidates(payload);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8001/api/v1/recruiter/match/candidates',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Service-Key': configValues.AI_SERVICE_API_KEY,
        },
        body: JSON.stringify(payload),
      }),
    );
  });

  it('calls the resume seniority prediction endpoint', async () => {
    const client = new AiRecommendationClient(configService as any);
    const payload = {
      resume: { role: 'Backend Engineer', skills: ['Python'] },
    };

    await client.predictResumeSeniority(payload);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8001/api/v1/predict/resume-seniority',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Service-Key': configValues.AI_SERVICE_API_KEY,
        },
        body: JSON.stringify(payload),
      }),
    );
  });

  it('calls the job seniority prediction endpoint', async () => {
    const client = new AiRecommendationClient(configService as any);
    const payload = {
      job: { job_title: 'Frontend Developer', must_have_skills: ['React'] },
    };

    await client.predictJobSeniority(payload);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8001/api/v1/predict/job-seniority',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Service-Key': configValues.AI_SERVICE_API_KEY,
        },
        body: JSON.stringify(payload),
      }),
    );
  });

  it('hides upstream status in ServiceUnavailableException message and attaches a bounded cause', async () => {
    const longUpstreamBody = `Traceback: ${'x'.repeat(500)}`;
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve(longUpstreamBody),
    } as Response);
    const client = new AiRecommendationClient(
      configService as unknown as ConfigService,
    );

    let caught: unknown;
    try {
      await client.matchJobs({
        resume: { role: 'Backend Engineer' },
        jobs: [],
        top_k: 5,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    const exception = caught as ServiceUnavailableException;
    expect(exception.message).toBe('AI recommendation service is unavailable');
    expect(exception.message).not.toContain('502');
    expect(exception.cause).toBeInstanceOf(Error);
    const causeMessage = (exception.cause as Error).message;
    expect(causeMessage).toContain('/api/v1/match/jobs');
    expect(causeMessage).toContain('502');
    expect(causeMessage).toContain('Traceback:');
    expect(causeMessage.endsWith('...')).toBe(true);
    expect(causeMessage.length).toBeLessThan(380);
  });
});
