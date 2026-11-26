import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RealtimeTicketService } from '../realtime-ticket.service';

describe('RealtimeTicketService', () => {
  const jwt = new JwtService({
    secret: 'test-secret',
    signOptions: {
      algorithm: 'HS256',
      issuer: 'test-issuer',
      audience: 'test-audience',
    },
  });
  const service = new RealtimeTicketService(jwt);

  it('issues a unique 60-second session-bound socket JWT without email', () => {
    const first = service.issue(42, 'session-42', 'USER');
    const second = service.issue(42, 'session-42', 'USER');
    const payload = jwt.verify(first.token, {
      algorithms: ['HS256'],
      issuer: 'test-issuer',
      audience: 'test-audience',
    });

    expect(first.expiresInSeconds).toBe(60);
    expect(payload).toMatchObject({
      sub: 42,
      sid: 'session-42',
      role: 'USER',
      type: 'socket',
      jti: expect.any(String),
    });
    expect(payload.exp - payload.iat).toBe(60);
    expect(payload).not.toHaveProperty('email');
    expect(jwt.decode(second.token).jti).not.toBe(payload.jti);
  });

  it.each([undefined, null, '', ' '])(
    'refuses a missing session ID: %j',
    (sid) => {
      expect(() => service.issue(42, sid as never, 'USER')).toThrow(
        UnauthorizedException,
      );
    },
  );

  it.each(['42', 0, -1, 1.5])('refuses an invalid user ID: %j', (userId) => {
    expect(() => service.issue(userId as never, 'session-42', 'USER')).toThrow(
      UnauthorizedException,
    );
  });

  it.each([undefined, '', ' '])('refuses a missing role: %j', (role) => {
    expect(() => service.issue(42, 'session-42', role as never)).toThrow(
      UnauthorizedException,
    );
  });
});
