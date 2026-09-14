import { RealtimeTicketController } from './realtime-ticket.controller';

describe('RealtimeTicketController', () => {
  it('issues a ticket for the authenticated user', () => {
    const ticketService = {
      issue: jest.fn().mockReturnValue({ token: 'socket-token', expiresInSeconds: 60 }),
    };
    const controller = new RealtimeTicketController(ticketService as never);

    expect(controller.issue({ user: { id: 42, email: 'user@example.com' } } as never)).toEqual({
      content: { token: 'socket-token', expiresInSeconds: 60 },
    });
    expect(ticketService.issue).toHaveBeenCalledWith(42, 'user@example.com');
  });
});
