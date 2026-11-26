import { buildCorsOptions } from '../cors-options';

describe('buildCorsOptions', () => {
  it('exposes X-Request-ID for cross-origin error responses and keeps standard CORS settings', () => {
    const options = buildCorsOptions(['https://jobaura.example']);

    expect(options).toEqual({
      origin: ['https://jobaura.example'],
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-CSRF-Token',
        'sentry-trace',
        'baggage',
      ],
      exposedHeaders: ['X-Request-ID'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    });
  });
});
