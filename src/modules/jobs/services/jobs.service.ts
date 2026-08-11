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

  create(createDto: CreateJobDto, userId: number) {
    return this.mutations.create(createDto, userId);
  }

  findAll() {
    return this.search.findAll();
  }

  findAllWithPagination(query: JobSearchQueryDto) {
    return this.search.findAllWithPagination(query);
  }

  findAllWithCursor(query: JobCursorQueryDto) {
    return this.search.findAllWithCursor(query);
  }

  findByCreator(creatorId: number, paginationDto: PaginationDto) {
    return this.search.findByCreator(creatorId, paginationDto);
  }

  findOne(id: number) {
    return this.search.findOne(id);
  }

  update(id: number, updateDto: UpdateJobDto, userId: number, userRole: Role) {
    return this.mutations.update(id, updateDto, userId, userRole);
  }

  remove(id: number, userId: number, userRole: Role) {
    return this.mutations.remove(id, userId, userRole);
  }

  ensureCanManageJob(id: number, userId: number, userRole: Role) {
    return this.mutations.ensureCanManageJob(id, userId, userRole);
  }

  uploadImage(id: number, filename: string, userId: number, userRole: Role) {
    return this.mutations.uploadImage(id, filename, userId, userRole);
  }

  getCategoryMenu() {
    return this.catalog.getCategoryMenu();
  }

  getSubcategoriesByCategory(categoryId: number) {
    return this.catalog.getSubcategoriesByCategory(categoryId);
  }

  getJobsBySubcategory(subcategoryId: number) {
    return this.catalog.getJobsBySubcategory(subcategoryId);
  }

  getJobDetails(jobId: number) {
    return this.search.getJobDetails(jobId);
  }

  searchByName(title: string) {
    return this.search.searchByName(title);
  }
}
