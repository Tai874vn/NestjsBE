import { UnauthorizedException } from '@nestjs/common';
import { RealtimeTicketController } from '../realtime-ticket.controller';

describe('RealtimeTicketController', () => {
  const createController = () => {
    const ticketService = {
      issue: jest
        .fn()
        .mockReturnValue({ token: 'socket-token', expiresInSeconds: 60 }),
    };
    return {
      controller: new RealtimeTicketController(ticketService as never),
      ticketService,
    };
  };

  it('issues a ticket using only the validated user session and role', () => {
    const { controller, ticketService } = createController();

    expect(
      controller.issue({
        user: {
          id: 42,
          email: 'user@example.com',
          role: 'USER',
          sessionId: 'session-42',
        },
      } as never),
    ).toEqual({
      content: { token: 'socket-token', expiresInSeconds: 60 },
    });
    expect(ticketService.issue).toHaveBeenCalledWith(42, 'session-42', 'USER');
  });

  it.each([
    {},
    { user: { id: 42, role: 'USER' } },
    { user: { id: 42, role: 'USER', sessionId: '' } },
    { user: { id: 42, role: 'USER', sessionId: ' ' } },
  ])('rejects requests without a validated session: %j', (request) => {
    const { controller, ticketService } = createController();

    expect(() => controller.issue(request as never)).toThrow(
      UnauthorizedException,
    );
    expect(ticketService.issue).not.toHaveBeenCalled();
  });
});
