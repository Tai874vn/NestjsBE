import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
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

/** A skill from the AI service's ESCO/O*NET dictionary. */
export interface AiSkillSummary {
  id: string;
  name: string;
  kind: string;
  reuse: string | null;
  fields: Record<string, number>;
  hot: boolean;
}

export interface AiFoundSkill extends AiSkillSummary {
  matched: string[];
  count: number;
}

export interface AiFieldOfStudy {
  code: string;
  name: string;
  broad: string;
  narrow: string;
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

  /** Dictionary skills matching `query`; skills of `occupation` (an ESCO code) are listed first. */
  async searchSkills(
    query: string,
    occupation?: string,
    limit = 10,
  ): Promise<AiSkillSummary[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (occupation) params.set('occupation', occupation);
    const response = await this.get<{ skills: AiSkillSummary[] }>(
      `/api/v1/skills/search?${params.toString()}`,
    );
    return response.skills;
  }

  async extractSkills(text: string): Promise<AiFoundSkill[]> {
    const response = await this.post<{ skills: AiFoundSkill[] }>(
      '/api/v1/skills/extract',
      { text },
    );
    return response.skills;
  }

  /** One result per name, in order; null when the name is not a dictionary skill. */
  async resolveSkills(names: string[]): Promise<Array<AiSkillSummary | null>> {
    const response = await this.post<{
      skills: Array<AiSkillSummary | null>;
    }>('/api/v1/skills/resolve', { names });
    return response.skills;
  }

  /** Whether the AI service answers its health check within a short time. Never throws. */
  async isAvailable(timeoutMs = 3000): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async errorDetail(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') return body.detail;
    } catch {
      // fall through to the status text
    }
    return `AI service rejected the request (${response.status})`;
  }

  async fieldsOfStudy(): Promise<AiFieldOfStudy[]> {
    const response = await this.get<{ fields: AiFieldOfStudy[] }>(
      '/api/v1/fields-of-study',
    );
    return response.fields;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private post<T>(path: string, payload: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  private async request<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: string },
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Service-Key': this.serviceApiKey,
        },
        signal: controller.signal,
      });

      if (response.status === 400 || response.status === 422) {
        // The service is up but refused this input (for example, no field chosen): not worth retrying.
        throw new BadRequestException(await this.errorDetail(response));
      }
      if (!response.ok) {
        throw new ServiceUnavailableException(
          `AI service returned ${response.status}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof BadRequestException
      ) {
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
