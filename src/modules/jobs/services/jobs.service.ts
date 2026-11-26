import { Injectable } from '@nestjs/common';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Role } from '../../../common/constants/roles';
import { CreateJobDto } from '../dto/create-job.dto';
import { JobCursorQueryDto } from '../dto/job-cursor-query.dto';
import { JobSearchQueryDto } from '../dto/job-search-query.dto';
import { UpdateJobDto } from '../dto/update-job.dto';
import { JobCatalogService } from './job-catalog.service';
import { JobMutationService } from './job-mutation.service';
import { JobSearchService } from './job-search.service';

@Injectable()
export class JobsService {
  constructor(
    private readonly mutations: JobMutationService,
    private readonly search: JobSearchService,
    private readonly catalog: JobCatalogService,
  ) {}

  // POST /api/jobs — Creates a service / portfolio post.
  // Query: job-mutation.service.ts create()
  create(createDto: CreateJobDto, userId: number) {
    return this.mutations.create(createDto, userId);
  }

  // GET /api/jobs — Every service post (old list).
  // Query: job-search.service.ts findAll()
  findAll() {
    return this.search.findAll();
  }

  // GET /api/jobs/paginated-search — The /jobs browse list: search, filters, page.
  // Query: job-search.service.ts findAllWithPagination()
  findAllWithPagination(query: JobSearchQueryDto) {
    return this.search.findAllWithPagination(query);
  }

  // GET /api/jobs/cursor — Service posts by cursor (endless scroll).
  // Query: job-search.service.ts findAllWithCursor()
  findAllWithCursor(query: JobCursorQueryDto) {
    return this.search.findAllWithCursor(query);
  }

  // GET /api/jobs/by-creator/:creatorId — Service posts of one seller.
  // Query: job-search.service.ts findByCreator()
  findByCreator(creatorId: number, paginationDto: PaginationDto) {
    return this.search.findByCreator(creatorId, paginationDto);
  }

  // GET /api/jobs/:id — One service post.
  // Query: job-search.service.ts findOne()
  findOne(id: number) {
    return this.search.findOne(id);
  }

  // PUT /api/jobs/:id — Owner (or admin) edits a service post.
  // Query: job-mutation.service.ts update()
  update(id: number, updateDto: UpdateJobDto, userId: number, userRole: Role) {
    return this.mutations.update(id, updateDto, userId, userRole);
  }

  // DELETE /api/jobs/:id — Owner (or admin) deletes a service post.
  // Query: job-mutation.service.ts remove()
  remove(id: number, userId: number, userRole: Role) {
    return this.mutations.remove(id, userId, userRole);
  }

  // POST /api/jobs/upload-image/:jobId — Checks the uploader owns the post before an image upload.
  // Query: job-mutation.service.ts ensureCanManageJob()
  ensureCanManageJob(id: number, userId: number, userRole: Role) {
    return this.mutations.ensureCanManageJob(id, userId, userRole);
  }

  uploadImage(id: number, filename: string, userId: number, userRole: Role) {
    return this.mutations.uploadImage(id, filename, userId, userRole);
  }

  // GET /api/jobs/category-menu — Categories with their subcategories for the menu.
  // Query: job-catalog.service.ts getCategoryMenu()
  getCategoryMenu() {
    return this.catalog.getCategoryMenu();
  }

  // GET /api/jobs/subcategories/by-category/:categoryId — Subcategories of one category.
  // Query: job-catalog.service.ts getSubcategoriesByCategory()
  getSubcategoriesByCategory(categoryId: number) {
    return this.catalog.getSubcategoriesByCategory(categoryId);
  }

  // GET /api/jobs/by-subcategory/:subcategoryId — Service posts in one subcategory.
  // Query: job-catalog.service.ts getJobsBySubcategory()
  getJobsBySubcategory(subcategoryId: number) {
    return this.catalog.getJobsBySubcategory(subcategoryId);
  }

  // GET /api/jobs/details/:jobId — The service page: post, seller, packages, reviews.
  // Query: job-search.service.ts getJobDetails()
  getJobDetails(jobId: number) {
    return this.search.getJobDetails(jobId);
  }

  // GET /api/jobs/search/:name — Service posts whose title matches a name.
  // Query: job-search.service.ts searchByName()
  searchByName(title: string) {
    return this.search.searchByName(title);
  }
}
