import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { HiringApplicationStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { Role } from '../../../common/constants/roles';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import {
  GENERIC_SERVER_ERROR_MESSAGE,
  resolveRequestId,
} from '../../../common/errors/all-exceptions.filter';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../../prisma.service';
import { ValidatedUser } from '../../../types';
import { StorageService } from '../services/storage.service';

/**
 * Authenticated downloads for private documents (such as CVs).
 * Nginx never serves `private/` directly; every request checks ownership or an active employer
 * application link first and returns 404 when the file is missing or the caller cannot view it.
 */
@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get('documents/*path')
  async downloadDocument(
    @Param('path') pathParam: string | string[],
    @CurrentUser() user: ValidatedUser,
    @Req() req: Request & { requestId?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const tail = Array.isArray(pathParam) ? pathParam.join('/') : pathParam;
    const key = this.storage.extractKey(`documents/${tail}`);
    if (!key || !key.startsWith('documents/')) {
      throw new NotFoundException('File not found');
    }

    const resume = await this.prisma.userResume.findFirst({
      where: {
        OR: [{ sourceFileUrl: key }, { sourceFilePublicId: key }],
      },
      select: { userId: true },
    });
    if (!resume) {
      throw new NotFoundException('File not found');
    }

    const canView = await this.canViewResume(user, resume.userId);
    if (!canView) {
      throw new NotFoundException('File not found');
    }

    const file = await this.storage.openDocumentStream(key);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    const streamable = new StreamableFile(file.stream, {
      type: file.contentType,
      disposition: `attachment; filename="resume${file.extension}"`,
      length: file.size,
    });
    // Never leak filesystem paths or OS error text if the read stream fails.
    streamable.setErrorHandler((err, response) => {
      const requestId = resolveRequestId(req);
      this.logger.error(
        `[${requestId}] Failed to stream private document (${key}): ${err.message}`,
      );
      if (response.destroyed) return;
      if (response.headersSent) {
        // Destroy the socket instead of ending cleanly so a truncated download is not treated as complete.
        if (typeof response.destroy === 'function') {
          response.destroy();
        } else {
          response.end();
        }
        return;
      }
      res.removeHeader('Content-Disposition');
      res.removeHeader('Content-Length');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Request-ID', requestId);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: GENERIC_SERVER_ERROR_MESSAGE,
        error: 'Internal Server Error',
        requestId,
      });
    });
    return streamable;
  }

  private async canViewResume(
    viewer: ValidatedUser,
    ownerUserId: number,
  ): Promise<boolean> {
    if (viewer.id === ownerUserId || viewer.role === Role.ADMIN) {
      return true;
    }
    if (viewer.role !== Role.EMPLOYER) {
      return false;
    }

    const application = await this.prisma.hiringApplication.findFirst({
      where: {
        applicantId: ownerUserId,
        status: { not: HiringApplicationStatus.WITHDRAWN },
        hiringPost: {
          recruiterId: viewer.id,
        },
      },
      select: { id: true },
    });
    return Boolean(application);
  }
}
