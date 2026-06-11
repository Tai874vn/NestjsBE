import { Injectable } from '@nestjs/common';

export type RecommendationLabel = 'high_match' | 'medium_match' | 'low_match';

export interface RecommendationScoreInput {
  aiScore: number;
  resumeSkills: string[];
  resumeText: string;
  jobText: string;
  jobCategoryText?: string;
}

export interface RecommendationScore {
  aiScore: number;
  finalScore: number;
  label: RecommendationLabel;
  skillScore: number;
  seniorityScore: number;
  categoryScore: number;
}

@Injectable()
export class RecommendationScoringService {
  scoreJobMatch(input: RecommendationScoreInput): RecommendationScore {
    return this.score(input);
  }

  scoreCandidateMatch(input: RecommendationScoreInput): RecommendationScore {
    return this.score(input);
  }

  private score(input: RecommendationScoreInput): RecommendationScore {
    const aiScore = this.clamp(input.aiScore);
    const skillScore = this.skillOverlapScore(input.resumeSkills, input.jobText);
    const seniorityScore = this.seniorityScore(input.resumeText, input.jobText);
    const categoryScore = this.categoryScore(input.resumeText, input.jobCategoryText);
    const finalScore = this.clamp(
      aiScore * 0.65 + skillScore * 0.2 + seniorityScore * 0.1 + categoryScore * 0.05,
    );

    return {
      aiScore,
      finalScore: this.round(finalScore),
      label: this.label(finalScore),
      skillScore: this.round(skillScore),
      seniorityScore: this.round(seniorityScore),
      categoryScore: this.round(categoryScore),
    };
  }

  private skillOverlapScore(skills: string[], targetText: string): number {
    const normalizedText = this.normalize(targetText);
    const uniqueSkills = [...new Set(skills.map((skill) => skill.trim()).filter(Boolean))];
    if (!uniqueSkills.length) {
      return 0;
    }

    const matches = uniqueSkills.filter((skill) => normalizedText.includes(this.normalize(skill)));
    return matches.length / uniqueSkills.length;
  }

  private seniorityScore(leftText: string, rightText: string): number {
    const left = this.detectSeniority(leftText);
    const right = this.detectSeniority(rightText);
    if (!left || !right) {
      return 0;
    }
    return left === right ? 1 : 0;
  }

  private categoryScore(profileText: string, categoryText?: string): number {
    if (!categoryText?.trim()) {
      return 0;
    }
    return this.normalize(profileText).includes(this.normalize(categoryText)) ? 1 : 0;
  }

  private detectSeniority(text: string): string | null {
    const normalized = this.normalize(text);
    if (normalized.includes('senior') || normalized.includes('lead') || normalized.includes('principal')) {
      return 'senior';
    }
    if (normalized.includes('junior') || normalized.includes('entry level') || normalized.includes('intern')) {
      return 'junior';
    }
    if (normalized.includes('middle') || normalized.includes('mid level') || normalized.includes('mid-level')) {
      return 'mid';
    }
    return null;
  }

  private label(score: number): RecommendationLabel {
    if (score >= 0.75) {
      return 'high_match';
    }
    if (score >= 0.6) {
      return 'medium_match';
    }
    return 'low_match';
  }

  private normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();
  }

  private clamp(value: number): number {
    if (Number.isNaN(value)) {
      return 0;
    }
    return Math.min(1, Math.max(0, value));
  }

  private round(value: number): number {
    return Math.round(value * 10000) / 10000;
  }
}
