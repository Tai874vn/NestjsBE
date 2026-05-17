import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.chatMessage.deleteMany();
  await prisma.chatRoomMember.deleteMany();
  await prisma.chatRoom.deleteMany();
  await prisma.hire.deleteMany();
  await prisma.comment.deleteMany();
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
      phone: '555-0100',
      birthDay: '1990-01-01',
      gender: 'other',
      role: 'admin',
      skill: JSON.stringify(['Project Management', 'Backend Development']),
      certification: JSON.stringify(['AWS Cloud Practitioner']),
      avatar: 'https://i.pravatar.cc/300?img=12',
    },
  });

  const alex = await prisma.user.create({
    data: {
      name: 'Alex Carter',
      email: 'alex@example.com',
      password,
      phone: '555-0101',
      birthDay: '1994-03-18',
      gender: 'male',
      role: 'user',
      skill: JSON.stringify(['UI Design', 'Figma', 'Brand Identity']),
      certification: JSON.stringify(['Google UX Design']),
      avatar: 'https://i.pravatar.cc/300?img=33',
    },
  });

  const maya = await prisma.user.create({
    data: {
      name: 'Maya Nguyen',
      email: 'maya@example.com',
      password,
      phone: '555-0102',
      birthDay: '1996-08-09',
      gender: 'female',
      role: 'user',
      skill: JSON.stringify(['React', 'Next.js', 'NestJS']),
      certification: JSON.stringify(['Meta Front-End Developer']),
      avatar: 'https://i.pravatar.cc/300?img=47',
    },
  });

  const jordan = await prisma.user.create({
    data: {
      name: 'Jordan Lee',
      email: 'jordan@example.com',
      password,
      phone: '555-0103',
      birthDay: '1992-11-24',
      gender: 'male',
      role: 'user',
      skill: JSON.stringify(['SEO', 'Copywriting', 'Content Strategy']),
      certification: JSON.stringify(['HubSpot Content Marketing']),
      avatar: 'https://i.pravatar.cc/300?img=52',
    },
  });

  const design = await prisma.category.create({
    data: {
      name: 'Design',
      subcategories: {
        create: [
          {
            name: 'Logo Design',
            image:
              'https://images.unsplash.com/photo-1634942537034-2531766767d1',
          },
          {
            name: 'UI/UX Design',
            image:
              'https://images.unsplash.com/photo-1586717791821-3f44a563fa4c',
          },
        ],
      },
    },
    include: { subcategories: true },
  });

  const development = await prisma.category.create({
    data: {
      name: 'Development',
      subcategories: {
        create: [
          {
            name: 'Frontend Development',
            image:
              'https://images.unsplash.com/photo-1498050108023-c5249f4df085',
          },
          {
            name: 'Backend Development',
            image:
              'https://images.unsplash.com/photo-1558494949-ef010cbdcc31',
          },
        ],
      },
    },
    include: { subcategories: true },
  });

  const marketing = await prisma.category.create({
    data: {
      name: 'Marketing',
      subcategories: {
        create: [
          {
            name: 'SEO',
            image:
              'https://images.unsplash.com/photo-1460925895917-afdab827c52f',
          },
          {
            name: 'Content Writing',
            image:
              'https://images.unsplash.com/photo-1455390582262-044cdead277a',
          },
        ],
      },
    },
    include: { subcategories: true },
  });

  const [logoDesign, uiDesign] = design.subcategories;
  const [frontendDevelopment, backendDevelopment] =
    development.subcategories;
  const [seo, contentWriting] = marketing.subcategories;

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

  await prisma.hire.createMany({
    data: [
      { jobId: jobs[0].id, hirerId: maya.id, completed: true },
      { jobId: jobs[2].id, hirerId: alex.id, completed: false },
      { jobId: jobs[4].id, hirerId: admin.id, completed: false },
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
    `Seeded ${4} users, ${3} categories, ${6} subcategories, ${jobs.length} jobs, ${4} comments, ${3} hires, and ${1} chat room.`,
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
