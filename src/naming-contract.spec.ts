import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { JobsController } from './modules/jobs/controllers/jobs.controller';
import { CategoriesController } from './modules/categories/controllers/categories.controller';
import { SubcategoriesController } from './modules/subcategories/controllers/subcategories.controller';
import { CommentsController } from './modules/comments/controllers/comments.controller';
import { HiresController } from './modules/hires/controllers/hires.controller';
import { UsersController } from './modules/users/controllers/users.controller';
import { CreateJobDto } from './modules/jobs/dto/create-job.dto';
import { CreateCategoryDto } from './modules/categories/dto/create-category.dto';
import { CreateSubcategoryDto } from './modules/subcategories/dto/create-subcategory.dto';
import { CreateCommentDto } from './modules/comments/dto/create-comment.dto';
import { CreateHireDto } from './modules/hires/dto/create-hire.dto';

describe('English naming contract', () => {
  it('uses English route roots for renamed resources', () => {
    expect(Reflect.getMetadata(PATH_METADATA, JobsController)).toBe('jobs');
    expect(Reflect.getMetadata(PATH_METADATA, CategoriesController)).toBe(
      'categories',
    );
    expect(Reflect.getMetadata(PATH_METADATA, SubcategoriesController)).toBe(
      'subcategories',
    );
    expect(Reflect.getMetadata(PATH_METADATA, CommentsController)).toBe(
      'comments',
    );
    expect(Reflect.getMetadata(PATH_METADATA, HiresController)).toBe('hires');
    expect(Reflect.getMetadata(PATH_METADATA, UsersController)).toBe('users');
  });

  it('accepts English DTO property names for API requests', () => {
    const job: CreateJobDto = {
      title: 'Build landing page',
      price: 500,
      subcategoryId: 1,
      reviews: 0,
      image: 'https://example.test/job.png',
      description: 'Full responsive landing page',
      shortDescription: 'Responsive landing page',
      rating: 5,
    };
    const category: CreateCategoryDto = { name: 'Design' };
    const subcategory: CreateSubcategoryDto = {
      name: 'UI Design',
      image: 'https://example.test/subcategory.png',
      categoryId: 1,
    };
    const comment: CreateCommentDto = {
      jobId: 1,
      content: 'Clear requirements',
      rating: 5,
    };
    const hire: CreateHireDto = { jobId: 1 };

    expect(job.title).toBe('Build landing page');
    expect(category.name).toBe('Design');
    expect(subcategory.categoryId).toBe(1);
    expect(comment.jobId).toBe(1);
    expect(hire.jobId).toBe(1);
  });
});
