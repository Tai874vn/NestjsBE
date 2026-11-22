import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InterviewMode, InterviewStatus } from '@prisma/client';
import { Role } from '../../common/constants/roles';
import { VideoCallService } from './video-call.service';

const NOW = new Date('2026-11-23T03:00:00Z');
const recruiter = { id: 2, role: Role.EMPLOYER };
const candidate = { id: 7, role: Role.USER };

const ENV: Record<string, string> = {
  LIVEKIT_URL: 'wss://jobaura.livekit.test',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'a-long-enough-dev-secret-for-signing-tokens',
};

/** The payload (middle part) of a JWT [a signed token], decoded. */
function decode(token: string) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    sub: string;
    name?: string;
    video: {
      room: string;
      roomJoin: boolean;
      canPublish: boolean;
      canSubscribe: boolean;
    };
  };
}

describe('VideoCallService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function createService(
    options: {
      env?: Record<string, string>;
      mode?: InterviewMode;
      status?: InterviewStatus;
      missing?: boolean;
    } = {},
  ) {
    const interview = {
      id: 5,
      mode: options.mode ?? InterviewMode.ONLINE,
      status: options.status ?? InterviewStatus.SCHEDULED,
      application: {
        applicantId: 7,
        applicant: { name: 'Minh' },
        hiringPost: { recruiterId: 2, recruiter: { name: 'Lan' } },
      },
    };
    const prisma = {
      interview: {
        findUnique: jest
          .fn()
          .mockResolvedValue(options.missing ? null : interview),
      },
    };
    const config = { get: jest.fn((key: string) => (options.env ?? ENV)[key]) };
    const service = new VideoCallService(prisma as never, config as never);
    return { prisma, service };
  }

  it('gives the candidate a token for the room, with the identity and the publish grants', async () => {
    const { service } = createService();

    const result = await service.callToken(5, candidate);

    expect(result.url).toBe(ENV.LIVEKIT_URL);
    expect(result.roomName).toBe('jobaura-interview-5');
    expect(result.expiresAt).toBe('2026-11-23T05:00:00.000Z');
    const claims = decode(result.token);
    expect(claims.sub).toBe('user-7');
    expect(claims.name).toBe('Minh');
    expect(claims.video.room).toBe('jobaura-interview-5');
    expect(claims.video.roomJoin).toBe(true);
    expect(claims.video.canPublish).toBe(true);
    expect(claims.video.canSubscribe).toBe(true);
  });

  it('gives the recruiter a token with their own identity', async () => {
    const { service } = createService();

    const claims = decode((await service.callToken(5, recruiter)).token);

    expect(claims.sub).toBe('user-2');
    expect(claims.name).toBe('Lan');
  });

  it('a stranger and an admin get 403', async () => {
    const { service } = createService();

    await expect(
      service.callToken(5, { id: 3, role: Role.EMPLOYER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.callToken(5, { id: 1, role: Role.ADMIN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an interview that does not exist is 404', async () => {
    const { service } = createService({ missing: true });

    await expect(service.callToken(5, candidate)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    [
      InterviewStatus.PROPOSED,
      'This interview has no agreed time yet, so there is no call to join.',
    ],
    [
      InterviewStatus.RESCHEDULE_REQUESTED,
      'New times for this interview are still being arranged, so there is no call to join.',
    ],
    [InterviewStatus.COMPLETED, 'This interview has already finished.'],
    [InterviewStatus.CANCELLED, 'This interview was cancelled.'],
  ])('an interview that is %s is 409 with a plain sentence', async (status, text) => {
    const { service } = createService({ status });

    const error: unknown = await service
      .callToken(5, candidate)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(text);
  });

  it('an onsite interview is 409 "This interview is not online."', async () => {
    const { service } = createService({ mode: InterviewMode.ONSITE });

    await expect(service.callToken(5, candidate)).rejects.toThrow(
      'This interview is not online.',
    );
  });

  it.each(['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'])(
    'without %s the answer is 503 "Video calls are not set up."',
    async (missing) => {
      const env = { ...ENV, [missing]: '' };
      const { service } = createService({ env });

      const error: unknown = await service
        .callToken(5, candidate)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Error).message).toBe('Video calls are not set up.');
    },
  );
});
