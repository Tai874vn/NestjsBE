import { AppService } from '../app.service';

describe('AppService', () => {
  it('returns hello world message', () => {
    const service = new AppService({} as never);

    expect(service.getHello()).toBe('Hello World!');
  });
});
