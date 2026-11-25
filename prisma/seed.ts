import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { loadJobTaxonomy } from './job-taxonomy';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.chatMessage.deleteMany();
  await prisma.chatRoomMember.deleteMany();
  await prisma.chatRoom.deleteMany();
  await prisma.comment.deleteMany();
  // Contracts first: a service or an account with contracts cannot be deleted (RESTRICT).
  await prisma.ledgerEntry.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.proposal.deleteMany();
  await prisma.job.deleteMany();
  await prisma.subcategory.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();

  const password = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.create({
    data: {
      name: 'Admin User',
      email: 'admin@example.com',
      password,
      emailVerifiedAt: new Date(),
      phone: '555-0100',
      birthDay: '1990-01-01',
      gender: 'other',
      role: 'admin',
      skill: JSON.stringify(['project management', 'Node.js']),
      certification: JSON.stringify(['AWS Cloud Practitioner']),
      avatar: 'https://i.pravatar.cc/300?img=12',
    },
  });

  const alex = await prisma.user.create({
    data: {
      name: 'Alex Carter',
      email: 'alex@example.com',
      password,
      emailVerifiedAt: new Date(),
      phone: '555-0101',
      birthDay: '1994-03-18',
      gender: 'male',
      role: 'user',
      skill: JSON.stringify(['graphic design', 'Figma', 'Adobe Illustrator']),
      certification: JSON.stringify(['Google UX Design']),
      avatar: 'https://i.pravatar.cc/300?img=33',
    },
  });

  const maya = await prisma.user.create({
    data: {
      name: 'Maya Nguyen',
      email: 'maya@example.com',
      password,
      emailVerifiedAt: new Date(),
      phone: '555-0102',
      birthDay: '1996-08-09',
      gender: 'female',
      role: 'user',
      skill: JSON.stringify(['React', 'TypeScript', 'Node.js']),
      certification: JSON.stringify(['Meta Front-End Developer']),
      avatar: 'https://i.pravatar.cc/300?img=47',
    },
  });

  const jordan = await prisma.user.create({
    data: {
      name: 'Jordan Lee',
      email: 'jordan@example.com',
      password,
      emailVerifiedAt: new Date(),
      phone: '555-0103',
      birthDay: '1992-11-24',
      gender: 'male',
      role: 'user',
      skill: JSON.stringify([
        'search engine optimisation',
        'perform copywriting',
        'content marketing strategy',
      ]),
      certification: JSON.stringify(['HubSpot Content Marketing']),
      avatar: 'https://i.pravatar.cc/300?img=52',
    },
  });

  // Job categories: the 37 career fields with their ISCO-08 unit groups (see prisma/job-taxonomy.ts).
  const taxonomy = loadJobTaxonomy();
  for (const category of taxonomy.categories) {
    await prisma.category.create({
      data: {
        name: category.name,
        subcategories: {
          create: category.subcategories.map((sub) => ({ name: sub.name })),
        },
      },
    });
  }
  const subcategories = await prisma.subcategory.findMany({
    include: { category: true },
  });
  const subcategory = (categoryName: string, name: string) => {
    const found = subcategories.find(
      (sub) => sub.category.name === categoryName && sub.name === name,
    );
    if (!found)
      throw new Error(`Missing subcategory ${categoryName} / ${name}`);
    return found;
  };
  const logoDesign = subcategory('Design', 'Graphic and multimedia designers');
  const uiDesign = logoDesign;
  const frontendDevelopment = subcategory(
    'Software development',
    'Web and multimedia developers',
  );
  const backendDevelopment = subcategory(
    'Software development',
    'Software developers',
  );
  const seo = subcategory(
    'Marketing and PR',
    'Advertising and marketing professionals',
  );
  const contentWriting = subcategory(
    'Media and arts',
    'Authors and related writers',
  );

  const jobs = await Promise.all([
    prisma.job.create({
      data: {
        title: 'I will design a modern logo for your business',
        reviews: 18,
        price: 150,
        image: 'https://images.unsplash.com/photo-1626785774573-4b799315345d',
        description:
          'Custom logo design with three concepts, color palette, and source files.',
        shortDescription: 'Modern business logo with source files.',
        rating: 5,
        subcategoryId: logoDesign.id,
        creatorId: alex.id,
      },
    }),
    prisma.job.create({
      data: {
        title: 'I will create a responsive SaaS dashboard UI',
        reviews: 26,
        price: 420,
        image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71',
        description:
          'Clean dashboard UI design for SaaS products, admin tools, and analytics platforms.',
        shortDescription: 'Responsive SaaS dashboard UI design.',
        rating: 5,
        subcategoryId: uiDesign.id,
        creatorId: alex.id,
      },
    }),
    prisma.job.create({
      data: {
        title: 'I will build a React landing page',
        reviews: 31,
        price: 550,
        image: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6',
        description:
          'Responsive React landing page with reusable components and clean styling.',
        shortDescription: 'Responsive React landing page.',
        rating: 5,
        subcategoryId: frontendDevelopment.id,
        creatorId: maya.id,
      },
    }),
    prisma.job.create({
      data: {
        title: 'I will build a NestJS REST API',
        reviews: 14,
        price: 700,
        image: 'https://images.unsplash.com/photo-1515879218367-8466d910aaa4',
        description:
          'NestJS API with authentication, Prisma models, validation, and clean module structure.',
        shortDescription: 'NestJS API with Prisma and auth.',
        rating: 5,
        subcategoryId: backendDevelopment.id,
        creatorId: maya.id,
      },
    }),
    prisma.job.create({
      data: {
        title: 'I will audit and improve your website SEO',
        reviews: 22,
        price: 260,
        image: 'https://images.unsplash.com/photo-1432888622747-4eb9a8efeb07',
        description:
          'Technical SEO audit, keyword recommendations, and practical improvement plan.',
        shortDescription: 'SEO audit and improvement plan.',
        rating: 4,
        subcategoryId: seo.id,
        creatorId: jordan.id,
      },
    }),
    prisma.job.create({
      data: {
        title: 'I will write conversion-focused website copy',
        reviews: 17,
        price: 220,
        image: 'https://images.unsplash.com/photo-1455390582262-044cdead277a',
        description:
          'Homepage, service page, or landing page copy tailored to your audience.',
        shortDescription: 'Conversion-focused website copy.',
        rating: 5,
        subcategoryId: contentWriting.id,
        creatorId: jordan.id,
      },
    }),
  ]);

  await prisma.comment.createMany({
    data: [
      {
        jobId: jobs[0].id,
        commenterId: maya.id,
        content: 'Clear process and strong final logo files.',
        rating: 5,
      },
      {
        jobId: jobs[1].id,
        commenterId: jordan.id,
        content: 'The dashboard layout was polished and easy to hand off.',
        rating: 5,
      },
      {
        jobId: jobs[2].id,
        commenterId: alex.id,
        content: 'Fast delivery and the page worked well on mobile.',
        rating: 5,
      },
      {
        jobId: jobs[4].id,
        commenterId: admin.id,
        content: 'Useful SEO report with clear priorities.',
        rating: 4,
      },
    ],
  });

  const room = await prisma.chatRoom.create({
    data: {
      name: 'Project kickoff',
      creatorId: admin.id,
      members: {
        create: [
          { userId: admin.id },
          { userId: alex.id },
          { userId: maya.id },
        ],
      },
    },
  });

  await prisma.chatMessage.createMany({
    data: [
      {
        roomId: room.id,
        senderId: admin.id,
        content: 'Welcome. Let us use this room for kickoff questions.',
      },
      {
        roomId: room.id,
        senderId: alex.id,
        content: 'Sounds good. I can share design references here.',
      },
      {
        roomId: room.id,
        senderId: maya.id,
        content: 'I will prepare the frontend checklist.',
      },
    ],
  });

  console.log(
    `Seeded ${4} users, ${taxonomy.categories.length} categories, ${subcategories.length} subcategories, ${jobs.length} jobs, ${4} comments, and ${1} chat room.`,
  );
  console.log('Demo login: admin@example.com / password123');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
