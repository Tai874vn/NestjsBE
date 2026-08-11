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

export interface AiResumeSeniorityRequest {
  resume: Record<string, unknown>;
}

export interface AiJobSeniorityRequest {
  job: Record<string, unknown>;
}

export interface AiSeniorityPredictionResponse {
  label: string;
  confidence: number;
  probabilities: Record<string, number>;
  features: Record<string, unknown>;
  model: string;
  elapsed_ms: number;
}

@Injectable()
export class AiRecommendationClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly serviceApiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService
      .getOrThrow<string>('AI_SERVICE_URL')
      .replace(/\/+$/, '');
    this.timeoutMs = Number(
      this.configService.get<string>('AI_SERVICE_TIMEOUT_MS') ?? 10000,
    );
    this.serviceApiKey =
      this.configService.getOrThrow<string>('AI_SERVICE_API_KEY');
  }

  matchJobs(payload: AiJobMatchRequest): Promise<AiMatchResponse> {
    return this.post<AiMatchResponse>('/api/v1/match/jobs', payload);
  }

  matchCandidates(payload: AiCandidateMatchRequest): Promise<AiMatchResponse> {
    return this.post<AiMatchResponse>('/api/v1/match/candidates', payload);
  }

  matchRecruiterCandidates(
    payload: AiCandidateMatchRequest,
  ): Promise<AiMatchResponse> {
    return this.post<AiMatchResponse>(
      '/api/v1/recruiter/match/candidates',
      payload,
    );
  }

  predictResumeSeniority(
    payload: AiResumeSeniorityRequest,
  ): Promise<AiSeniorityPredictionResponse> {
    return this.post<AiSeniorityPredictionResponse>(
      '/api/v1/predict/resume-seniority',
      payload,
    );
  }

  predictJobSeniority(
    payload: AiJobSeniorityRequest,
  ): Promise<AiSeniorityPredictionResponse> {
    return this.post<AiSeniorityPredictionResponse>(
      '/api/v1/predict/job-seniority',
      payload,
    );
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Service-Key': this.serviceApiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `AI service returned ${response.status}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'AI recommendation service is unavailable',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
