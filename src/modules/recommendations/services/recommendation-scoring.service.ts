import { Injectable } from '@nestjs/common';

export type RecommendationLabel = 'high_match' | 'medium_match' | 'low_match';
export type RecruiterMatchDecision = 'match' | 'no_match';

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
  isMatch?: boolean;
  matchLabel?: RecruiterMatchDecision;
  threshold?: number;
  source?: 'embedding_rerank' | 'classifier';
  skillScore: number;
  seniorityScore: number;
  categoryScore: number;
  requiredSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  improvementTips: string[];
}

const SKILL_TERMS: Array<{ name: string; aliases: string[] }> = [
  { name: 'Python', aliases: ['python'] },
  { name: 'JavaScript', aliases: ['javascript', 'js'] },
  { name: 'TypeScript', aliases: ['typescript', 'ts'] },
  { name: 'React', aliases: ['react', 'react.js', 'reactjs'] },
  { name: 'Next.js', aliases: ['next.js', 'nextjs'] },
  { name: 'Node.js', aliases: ['node.js', 'nodejs'] },
  { name: 'NestJS', aliases: ['nestjs', 'nest.js'] },
  { name: 'Express', aliases: ['express', 'express.js'] },
  { name: 'FastAPI', aliases: ['fastapi'] },
  { name: 'Django', aliases: ['django'] },
  { name: 'Flask', aliases: ['flask'] },
  { name: 'Java', aliases: ['java'] },
  { name: 'Spring Boot', aliases: ['spring boot', 'springboot'] },
  { name: 'C#', aliases: ['c#', 'c sharp'] },
  { name: '.NET', aliases: ['.net', 'dotnet'] },
  { name: 'PHP', aliases: ['php'] },
  { name: 'Laravel', aliases: ['laravel'] },
  { name: 'Go', aliases: ['golang', 'go programming'] },
  { name: 'SQL', aliases: ['sql'] },
  { name: 'PostgreSQL', aliases: ['postgresql', 'postgres'] },
  { name: 'MySQL', aliases: ['mysql'] },
  { name: 'MongoDB', aliases: ['mongodb', 'mongo'] },
  { name: 'Redis', aliases: ['redis'] },
  { name: 'Prisma', aliases: ['prisma'] },
  { name: 'Docker', aliases: ['docker'] },
  { name: 'Kubernetes', aliases: ['kubernetes', 'k8s'] },
  { name: 'AWS', aliases: ['aws', 'amazon web services'] },
  { name: 'Azure', aliases: ['azure'] },
  { name: 'GCP', aliases: ['gcp', 'google cloud'] },
  { name: 'CI/CD', aliases: ['ci/cd', 'cicd', 'continuous integration'] },
  { name: 'Git', aliases: ['git'] },
  { name: 'REST API', aliases: ['rest api', 'restful'] },
  { name: 'GraphQL', aliases: ['graphql'] },
  { name: 'HTML', aliases: ['html'] },
  { name: 'CSS', aliases: ['css'] },
  { name: 'Tailwind CSS', aliases: ['tailwind', 'tailwind css'] },
  { name: 'Figma', aliases: ['figma'] },
  { name: 'UI/UX', aliases: ['ui/ux', 'ux', 'user experience'] },
  { name: 'SEO', aliases: ['seo'] },
  { name: 'Data Analysis', aliases: ['data analysis', 'data analytics'] },
  { name: 'Machine Learning', aliases: ['machine learning', 'ml'] },
  { name: 'TensorFlow', aliases: ['tensorflow'] },
  { name: 'PyTorch', aliases: ['pytorch'] },
  { name: 'Cybersecurity', aliases: ['cybersecurity', 'cyber security'] },
  { name: 'Network Security', aliases: ['network security'] },
  { name: 'SIEM', aliases: ['siem'] },
  { name: 'Splunk', aliases: ['splunk'] },
  { name: 'Incident Response', aliases: ['incident response'] },
  { name: 'Penetration Testing', aliases: ['penetration testing', 'pentest'] },
  {
    name: 'Vulnerability Assessment',
    aliases: ['vulnerability assessment', 'vulnerability scanning'],
  },
  { name: 'SOC', aliases: ['soc', 'security operations center'] },
  { name: 'IAM', aliases: ['iam', 'identity and access management'] },
];

@Injectable()
export class RecommendationScoringService {
  scoreJobMatch(input: RecommendationScoreInput): RecommendationScore {
    return this.score(input);
  }

  scoreCandidateMatch(input: RecommendationScoreInput): RecommendationScore {
    return this.score(input);
  }

  scoreAiOnlyMatch(aiScore: number): RecommendationScore {
    const score = this.round(this.clamp(aiScore));
    return {
      aiScore: score,
      finalScore: score,
      label: this.label(score),
      skillScore: 0,
      seniorityScore: 0,
      categoryScore: 0,
      requiredSkills: [],
      matchedSkills: [],
      missingSkills: [],
      improvementTips: [],
    };
  }

  scoreRecruiterClassifierMatch(
    aiScore: number,
    metadata?: Record<string, unknown>,
  ): RecommendationScore {
    const score = this.round(this.clamp(aiScore));
    const threshold = this.classifierThreshold(metadata);
    const isMatch = this.classifierDecision(score, threshold, metadata);

    return {
      aiScore: score,
      finalScore: score,
      label: isMatch ? this.label(score) : 'low_match',
      isMatch,
      matchLabel: isMatch ? 'match' : 'no_match',
      threshold,
      source: 'classifier',
      skillScore: 0,
      seniorityScore: 0,
      categoryScore: 0,
      requiredSkills: [],
      matchedSkills: [],
      missingSkills: [],
      improvementTips: [],
    };
  }

  private score(input: RecommendationScoreInput): RecommendationScore {
    const aiScore = this.clamp(input.aiScore);
    const skillInsight = this.skillInsight(input);
    const skillScore = skillInsight.requiredSkills.length
      ? skillInsight.matchedSkills.length / skillInsight.requiredSkills.length
      : this.skillOverlapScore(input.resumeSkills, input.jobText);
    const seniorityScore = this.seniorityScore(input.resumeText, input.jobText);
    const categoryScore = this.categoryScore(
      input.resumeText,
      input.jobCategoryText,
    );
    const finalScore = this.clamp(
      aiScore * 0.65 +
        skillScore * 0.2 +
        seniorityScore * 0.1 +
        categoryScore * 0.05,
    );

    return {
      aiScore,
      finalScore: this.round(finalScore),
      label: this.label(finalScore),
      skillScore: this.round(skillScore),
      seniorityScore: this.round(seniorityScore),
      categoryScore: this.round(categoryScore),
      requiredSkills: skillInsight.requiredSkills,
      matchedSkills: skillInsight.matchedSkills,
      missingSkills: skillInsight.missingSkills,
      improvementTips: this.improvementTips(
        skillInsight.missingSkills,
        this.round(skillScore),
      ),
    };
  }

  private skillInsight(input: RecommendationScoreInput) {
    const requiredSkills = this.extractSkills(input.jobText);
    const candidateText = this.normalize(
      [input.resumeText, ...input.resumeSkills].join(' '),
    );
    const matchedSkills = requiredSkills.filter((skill) =>
      this.skillMatchesCandidate(skill, candidateText),
    );
    const missingSkills = requiredSkills.filter(
      (skill) => !matchedSkills.includes(skill),
    );

    return { requiredSkills, matchedSkills, missingSkills };
  }

  private extractSkills(text: string): string[] {
    const normalizedText = this.normalize(text);
    return SKILL_TERMS.flatMap((skill) =>
      skill.aliases.some((alias) =>
        this.includesTerm(normalizedText, this.normalize(alias)),
      )
        ? [skill.name]
        : [],
    );
  }

  private skillMatchesCandidate(
    skillName: string,
    candidateText: string,
  ): boolean {
    const skill = SKILL_TERMS.find((item) => item.name === skillName);
    if (!skill) {
      return this.includesTerm(candidateText, this.normalize(skillName));
    }
    return skill.aliases.some((alias) =>
      this.includesTerm(candidateText, this.normalize(alias)),
    );
  }

  private improvementTips(
    missingSkills: string[],
    skillScore: number,
  ): string[] {
    if (missingSkills.length) {
      const visibleSkills = missingSkills.slice(0, 4).join(', ');
      return [
        `Add profile or resume evidence for ${visibleSkills} if you have that experience.`,
        'Add project bullets that show how you used the missing skills in real work.',
      ];
    }

    if (skillScore < 0.5) {
      return [
        'Make your profile skills more explicit so matching can read your strongest tools.',
      ];
    }

    return [
      'Your listed skills cover the main detected requirements for this job.',
    ];
  }

  private skillOverlapScore(skills: string[], targetText: string): number {
    const normalizedText = this.normalize(targetText);
    const uniqueSkills = [
      ...new Set(skills.map((skill) => skill.trim()).filter(Boolean)),
    ];
    if (!uniqueSkills.length) {
      return 0;
    }

    const matches = uniqueSkills.filter((skill) =>
      normalizedText.includes(this.normalize(skill)),
    );
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
    return this.normalize(profileText).includes(this.normalize(categoryText))
      ? 1
      : 0;
  }

  private detectSeniority(text: string): string | null {
    const normalized = this.normalize(text);
    if (
      normalized.includes('senior') ||
      normalized.includes('lead') ||
      normalized.includes('principal')
    ) {
      return 'senior';
    }
    if (
      normalized.includes('junior') ||
      normalized.includes('entry level') ||
      normalized.includes('intern')
    ) {
      return 'junior';
    }
    if (
      normalized.includes('middle') ||
      normalized.includes('mid level') ||
      normalized.includes('mid-level')
    ) {
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

  private classifierDecision(
    score: number,
    threshold: number,
    metadata?: Record<string, unknown>,
  ): boolean {
    if (typeof metadata?.matching === 'boolean') {
      return metadata.matching;
    }
    if (metadata?.match_label === 'match' || metadata?.matchLabel === 'match') {
      return true;
    }
    if (
      metadata?.match_label === 'no_match' ||
      metadata?.matchLabel === 'no_match'
    ) {
      return false;
    }
    return score >= threshold;
  }

  private classifierThreshold(metadata?: Record<string, unknown>): number {
    const value = metadata?.threshold;
    return typeof value === 'number' && Number.isFinite(value)
      ? this.round(this.clamp(value))
      : 0.5;
  }

  private normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9+#.]+/g, ' ')
      .trim();
  }

  private includesTerm(
    normalizedText: string,
    normalizedTerm: string,
  ): boolean {
    if (!normalizedTerm) {
      return false;
    }
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`).test(normalizedText);
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
