import { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { RequestObservabilityInterceptor } from './request-observability.interceptor';

describe('RequestObservabilityInterceptor', () => {
  it('adds a request ID and records observed heavy routes', async () => {
    const observability = { recordHttp: jest.fn() };
    const interceptor = new RequestObservabilityInterceptor(observability as any);
    const request = {
      method: 'GET',
      path: '/api/recommendations/jobs',
      header: jest.fn((name: string) => (name === 'x-request-id' ? 'request-123' : undefined)),
      user: { id: 7, role: 'USER' },
    };
    const response = {
      statusCode: 200,
      setHeader: jest.fn(),
    };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    await lastValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) }));

    expect(response.setHeader).toHaveBeenCalledWith('X-Request-ID', 'request-123');
    expect(request).toHaveProperty('requestId', 'request-123');
    expect(observability.recordHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-123',
        method: 'GET',
        path: '/api/recommendations/jobs',
        statusCode: 200,
        observed: true,
        userId: 7,
        role: 'USER',
      }),
    );
  });
});
