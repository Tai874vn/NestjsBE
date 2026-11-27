/**
 * Signs short-lived LiveKit room access tokens for scheduled online interviews in the hiring-pipeline module.
 * Verifies that the caller is the interview's candidate or recruiter before issuing a join token.
 *
 * Calls: prisma.interview; LiveKit
 * Used by:
 *   - src/modules/hiring-pipeline/controllers/interviews.controller.ts
 *   - src/modules/hiring-pipeline/hiring-pipeline.module.ts
 */

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InterviewMode, InterviewStatus } from '@prisma/client';
import { AccessToken } from 'livekit-server-sdk';
import { PrismaService } from '../../../prisma.service';
import { Viewer } from './applications-query.service';

/** How long a call token lives (2 hours): longer than any interview, short enough to stay safe. */
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/** Plain sentences for an interview that is not SCHEDULED (409), so no raw status name reaches the user. */
const NOT_SCHEDULED_TEXT: Record<InterviewStatus, string> = {
  PROPOSED:
    'This interview has no agreed time yet, so there is no call to join.',
  RESCHEDULE_REQUESTED:
    'New times for this interview are still being arranged, so there is no call to join.',
  SCHEDULED: 'This interview is scheduled.',
  COMPLETED: 'This interview has already finished.',
  CANCELLED: 'This interview was cancelled.',
};

export type CallToken = {
  url: string;
  token: string;
  roomName: string;
  expiresAt: string;
};

/**
 * Video calls for online interviews, through LiveKit (the video server).
 * The backend does not carry any video: it only signs a short token (a signed pass) that lets one
 * person join one room on the LiveKit server. Only the two people of the interview may get a token
 * (the candidate and the post's recruiter, admins are not call participants).
 * It is a read, so there is no transaction or lock.
 */
@Injectable()
export class VideoCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // POST /api/interviews/:id/call-token — LiveKit pass to join the interview call (only its two sides, only while it is not over).
  // Query: interview.findUnique
  async callToken(id: number, viewer: Viewer): Promise<CallToken> {
    const interview = await this.prisma.interview.findUnique({
      where: { id },
      select: {
        id: true,
        mode: true,
        status: true,
        application: {
          select: {
            applicantId: true,
            applicant: { select: { name: true } },
            hiringPost: {
              select: {
                recruiterId: true,
                recruiter: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!interview) {
      throw new NotFoundException(`Interview with ID ${id} not found`);
    }

    const { application } = interview;
    let name: string;
    if (viewer.id === application.applicantId) {
      name = application.applicant.name;
    } else if (viewer.id === application.hiringPost.recruiterId) {
      name = application.hiringPost.recruiter.name;
    } else {
      throw new ForbiddenException(
        'You are not allowed to join this interview.',
      );
    }
    if (interview.mode !== InterviewMode.ONLINE) {
      throw new ConflictException('This interview is not online.');
    }
    if (interview.status !== InterviewStatus.SCHEDULED) {
      throw new ConflictException(NOT_SCHEDULED_TEXT[interview.status]);
    }

    const url = this.config.get<string>('LIVEKIT_URL');
    const apiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET');
    if (!url || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('Video calls are not set up.');
    }

    const roomName = `jobaura-interview-${interview.id}`;
    const at = new AccessToken(apiKey, apiSecret, {
      identity: `user-${viewer.id}`,
      name,
      // Derive the LiveKit TTL in seconds from TOKEN_TTL_MS so the token expiry and expiresAt stay in sync.
      ttl: Math.floor(TOKEN_TTL_MS / 1000),
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });
    return {
      url,
      token: await at.toJwt(),
      roomName,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    };
  }
}
