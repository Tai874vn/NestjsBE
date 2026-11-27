/**
 * Standalone fixture seed script for the hiring posts feature.
 * Defines 20 demo vacancies and inserts open hiring posts for existing @jobaura.test employer accounts inside a transaction, skipping duplicates.
 *
 * Calls: Role (common/constants/roles); prisma.user; prisma.hiringPost; PostgreSQL via PrismaClient, PrismaPg, and pg Pool
 * Used by:
 *   - run by hand: npm run db:seed:hiring
 */

import 'dotenv/config';
import { HiringPostStatus, Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Role } from '../common/constants/roles';

type Vacancy = [
  title: string,
  skills: string[],
  years: number,
  responsibilities: string,
];

const VACANCIES: Vacancy[] = [
  [
    'Junior React Developer',
    ['React', 'TypeScript', 'HTML', 'CSS', 'Git'],
    1,
    'Build accessible dashboards, integrate REST APIs, and write component tests.',
  ],
  [
    'Senior Next.js Developer',
    ['Next.js', 'React', 'TypeScript', 'Playwright'],
    5,
    'Lead frontend architecture, improve rendering performance, and mentor developers.',
  ],
  [
    'NestJS Backend Developer',
    ['NestJS', 'Node.js', 'PostgreSQL', 'Prisma', 'Docker'],
    3,
    'Build authenticated REST APIs, design database migrations, and maintain integrations.',
  ],
  [
    'Python FastAPI Developer',
    ['Python', 'FastAPI', 'PostgreSQL', 'Redis', 'Pytest'],
    3,
    'Develop API services, background processing, and reliable automated tests.',
  ],
  [
    'Senior Java Engineer',
    ['Java', 'Spring Boot', 'SQL', 'Kafka', 'JUnit'],
    5,
    'Design transaction services, improve event processing, and review backend code.',
  ],
  [
    'Full Stack TypeScript Developer',
    ['React', 'TypeScript', 'Node.js', 'PostgreSQL'],
    3,
    'Deliver product features from database models and APIs through responsive interfaces.',
  ],
  [
    'Flutter Mobile Developer',
    ['Flutter', 'Dart', 'Firebase', 'REST APIs'],
    2,
    'Create mobile application flows, integrate APIs, and prepare store releases.',
  ],
  [
    'DevOps Engineer',
    ['Docker', 'Kubernetes', 'AWS', 'Terraform', 'CI/CD'],
    3,
    'Maintain deployment pipelines, infrastructure automation, and service monitoring.',
  ],
  [
    'QA Automation Engineer',
    ['Playwright', 'Selenium', 'TypeScript', 'API Testing'],
    2,
    'Build regression coverage, investigate defects, and support reliable releases.',
  ],
  [
    'Data Analyst',
    ['SQL', 'Python', 'Power BI', 'Excel'],
    2,
    'Create reporting dashboards, validate business metrics, and communicate insights.',
  ],
  [
    'Machine Learning Engineer',
    ['Python', 'PyTorch', 'Transformers', 'scikit-learn'],
    3,
    'Train text embedding models, evaluate ranking quality, and deploy inference services.',
  ],
  [
    'Data Engineer',
    ['Python', 'SQL', 'Airflow', 'Spark', 'PostgreSQL'],
    3,
    'Build ETL pipelines, monitor data quality, and maintain analytics datasets.',
  ],
  [
    'Product UI/UX Designer',
    ['Figma', 'UI Design', 'UX Research', 'Prototyping'],
    2,
    'Research user workflows, prototype interfaces, and collaborate on design systems.',
  ],
  [
    'Brand and Graphic Designer',
    ['Adobe Illustrator', 'Photoshop', 'Brand Identity', 'Typography'],
    2,
    'Develop brand assets, prepare campaign artwork, and maintain visual consistency.',
  ],
  [
    'Digital Marketing Specialist',
    ['SEO', 'Google Analytics', 'Google Ads', 'Content Strategy'],
    2,
    'Plan campaigns, measure conversion funnels, and improve organic search visibility.',
  ],
  [
    'Content Writer',
    ['Copywriting', 'SEO', 'Editing', 'Content Strategy'],
    1,
    'Write clear product articles, edit campaign copy, and maintain editorial standards.',
  ],
  [
    'Business Analyst',
    ['Requirements Analysis', 'SQL', 'Agile', 'Jira'],
    3,
    'Document business requirements, map workflows, and coordinate acceptance criteria.',
  ],
  [
    'Technical Project Manager',
    ['Project Management', 'Scrum', 'Agile', 'Risk Management'],
    5,
    'Coordinate engineering delivery, manage dependencies, and communicate project risks.',
  ],
  [
    'Customer Success Specialist',
    ['Customer Support', 'CRM', 'Communication', 'Onboarding'],
    1,
    'Guide customer onboarding, investigate product questions, and share customer feedback.',
  ],
  [
    'Software Engineering Intern',
    ['JavaScript', 'HTML', 'CSS', 'Git'],
    0,
    'Implement small product improvements and learn testing and code review practices.',
  ],
];

export async function seedHiringPosts(
  prisma: Pick<Prisma.TransactionClient, 'user' | 'hiringPost'>,
): Promise<{ created: number; existing: number }> {
  const employers = await prisma.user.findMany({
    where: {
      role: Role.EMPLOYER,
      email: { endsWith: '@jobaura.test', mode: 'insensitive' },
    },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (!employers.length) {
    throw new Error(
      'Hiring seed requires an existing employer with an @jobaura.test email',
    );
  }

  const locations = ['Ho Chi Minh City', 'Hanoi', 'Da Nang', 'Remote'];
  let created = 0;
  let existing = 0;

  for (const [
    index,
    [title, skills, years, responsibilities],
  ] of VACANCIES.entries()) {
    const recruiterId = employers[index % employers.length].id;
    const post = await prisma.hiringPost.findFirst({
      where: { recruiterId, title },
      select: { id: true },
    });
    if (post) {
      existing++;
      continue;
    }

    const salaryMin = years === 0 ? 300 : 800 + years * 400;
    await prisma.hiringPost.create({
      data: {
        recruiterId,
        title,
        description: `Demo vacancy for JobAura. ${responsibilities} Work with a collaborative product team, document decisions, and participate in regular reviews. Salary is gross USD per month.`,
        requirements: `Required skills: ${skills.join(', ')}. ${years === 0 ? 'Students and recent graduates are welcome; no professional experience is required.' : `At least ${years} year${years === 1 ? '' : 's'} of relevant professional experience.`} Share examples of your work and communicate progress clearly.`,
        location: locations[index % locations.length],
        employmentType: years === 0 ? 'Internship' : 'Full-time',
        salaryMin,
        salaryMax: salaryMin + (years === 0 ? 200 : 800),
        status: HiringPostStatus.OPEN,
      },
      select: { id: true },
    });
    created++;
  }

  return { created, existing };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the hiring seed');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const result = await prisma.$transaction((tx) => seedHiringPosts(tx), {
      timeout: 30_000,
    });
    console.log('Hiring posts:', JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Hiring seed failed',
    );
    process.exitCode = 1;
  });
}
