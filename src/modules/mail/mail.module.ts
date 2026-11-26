import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccountEmailsService } from './services/account-emails.service';
import { EmailTokensService } from './services/email-tokens.service';
import { MailService } from './services/mail.service';

@Module({
  imports: [ConfigModule],
  providers: [MailService, EmailTokensService, AccountEmailsService],
  exports: [MailService, EmailTokensService, AccountEmailsService],
})
export class MailModule {}
