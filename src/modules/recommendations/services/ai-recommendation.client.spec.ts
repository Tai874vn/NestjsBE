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
      json: async () => ({ matches: [], model: 'test-model', elapsed_ms: 1 }),
    } as Response);
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
});
