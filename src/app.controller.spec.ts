import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  it('returns value from AppService', () => {
    const appService: Pick<AppService, 'getHello'> = {
      getHello: jest.fn().mockReturnValue('Hello from service'),
    };

    const controller = new AppController(appService as AppService);

    expect(controller.getHello()).toBe('Hello from service');
    expect(appService.getHello).toHaveBeenCalledTimes(1);
  });
});
