import { JwtService } from '@nestjs/jwt';
import { RealtimeTicketService } from './realtime-ticket.service';

describe('RealtimeTicketService', () => {
  it('issues a short-lived token restricted to realtime connections', () => {
    const jwtService = { sign: jest.fn().mockReturnValue('socket-token') };
    const service = new RealtimeTicketService(jwtService as unknown as JwtService);

    expect(service.issue(42, 'user@example.com')).toEqual({
      token: 'socket-token',
      expiresInSeconds: 60,
    });
    expect(jwtService.sign).toHaveBeenCalledWith(
      { sub: 42, email: 'user@example.com', type: 'socket' },
      { expiresIn: '60s' },
    );
  });
});
