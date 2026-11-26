import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ChatController } from '../chat.controller';

describe('ChatController routing', () => {
  it('mounts under chat because the app already adds the api global prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ChatController)).toBe('chat');
  });
});
