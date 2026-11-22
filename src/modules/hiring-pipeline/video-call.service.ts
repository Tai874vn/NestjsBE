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
import { PrismaService } from '../../prisma.service';
import { Viewer } from './applications-query.service';

/** How long a call token lives (2 hours): longer than any interview, short enough to stay safe. */
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

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
      throw new ConflictException(
        `This interview is ${interview.status}, so there is no call to join.`,
      );
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
      ttl: '2h',
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
