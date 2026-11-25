import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccountEmailsService } from './account-emails.service';
import { EmailTokensService } from './email-tokens.service';
import { MailService } from './mail.service';

@Module({
  imports: [ConfigModule],
  providers: [MailService, EmailTokensService, AccountEmailsService],
  exports: [MailService, EmailTokensService, AccountEmailsService],
})
export class MailModule {}
