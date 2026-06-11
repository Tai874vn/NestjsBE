import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AiMatchItem {
  rank: number;
  id: string;
  score: number;
  title?: string;
  details?: string;
  metadata?: Record<string, unknown>;
}

export interface AiMatchResponse {
  matches: AiMatchItem[];
  model: string;
  elapsed_ms: number;
}

export interface AiJobMatchRequest {
  resume: Record<string, unknown>;
  jobs: Array<Record<string, unknown>>;
  top_k: number;
}

export interface AiCandidateMatchRequest {
  job: Record<string, unknown>;
  candidates: Array<Record<string, unknown>>;
  top_k: number;
}

@Injectable()
export class AiRecommendationClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.getOrThrow<string>('AI_SERVICE_URL').replace(/\/+$/, '');
    this.timeoutMs = Number(this.configService.get<string>('AI_SERVICE_TIMEOUT_MS') ?? 10000);
  }

  matchJobs(payload: AiJobMatchRequest): Promise<AiMatchResponse> {
    return this.post('/api/v1/match/jobs', payload);
  }

  matchCandidates(payload: AiCandidateMatchRequest): Promise<AiMatchResponse> {
    return this.post('/api/v1/match/candidates', payload);
  }

  private async post(path: string, payload: unknown): Promise<AiMatchResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ServiceUnavailableException(`AI service returned ${response.status}`);
      }

      return (await response.json()) as AiMatchResponse;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException('AI recommendation service is unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}
