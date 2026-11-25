import { Injectable } from '@nestjs/common';
import { EmailToken, EmailTokenPurpose, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export function hashEmailToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * One-time tokens for links sent by mail.
 * - The raw token (32 random bytes) is only in the mail. The database keeps its SHA-256.
 * - A new token of the same kind cancels the older unused ones, so only the latest mail works.
 * - consume() marks the token used in the same UPDATE that checks it, so two clicks at the same
 *   moment cannot both succeed.
 */
@Injectable()
export class EmailTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(input: {
    userId: number;
    purpose: EmailTokenPurpose;
    email: string;
    ttlMs: number;
    now?: Date;
  }): Promise<string> {
    const now = input.now ?? new Date();
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      await tx.emailToken.updateMany({
        where: { userId: input.userId, purpose: input.purpose, usedAt: null },
        data: { usedAt: now },
      });
      await tx.emailToken.create({
        data: {
          userId: input.userId,
          purpose: input.purpose,
          email: input.email,
          tokenHash: hashEmailToken(token),
          expiresAt: new Date(now.getTime() + input.ttlMs),
        },
      });
    });
    return token;
  }

  /** The token row if the token is right, of this kind, unused and not expired; then it is used up. */
  async consume(
    token: string,
    purpose: EmailTokenPurpose,
    db: Db = this.prisma,
    now = new Date(),
  ): Promise<EmailToken | null> {
    if (!token || token.length > 200) return null;
    const tokenHash = hashEmailToken(token);
    const { count } = await db.emailToken.updateMany({
      where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count !== 1) return null;
    return db.emailToken.findUnique({ where: { tokenHash } });
  }

  /** When the last mail of this kind was sent to the user (used to slow down "send again"). */
  async lastIssuedAt(
    userId: number,
    purpose: EmailTokenPurpose,
  ): Promise<Date | null> {
    const last = await this.prisma.emailToken.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return last?.createdAt ?? null;
  }
}
