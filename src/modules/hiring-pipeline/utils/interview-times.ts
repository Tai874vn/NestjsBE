/**
 * Helper functions for validating proposed interview times and formatting dates in Vietnam time for the hiring-pipeline module.
 * Used when checking time slots and building readable interview messages for notifications and chat.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/modules/hiring-pipeline/services/interviews.service.ts
 *   - src/tools/demo-activity/build-chats.ts
 *   - src/tools/demo-activity/build-hiring.ts
 */

import { BadRequestException } from '@nestjs/common';
import { Interview, InterviewMode } from '@prisma/client';

// Small helpers for interview times: checking the proposed times and writing them in messages.

// Times in messages are written in Vietnam time, e.g. "Wed 25 Nov 10:00".
const VIETNAM_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** One time as "Wed 25 Nov 10:00" (built from its parts so the commas of en-GB do not show). */
export function formatVietnamTime(date: Date): string {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    VIETNAM_TIME.formatToParts(date).find((item) => item.type === type)
      ?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('hour')}:${part('minute')}`;
}

/**
 * Check the proposed times: 1 to 3, each a real date, each in the future, all different (compared
 * as milliseconds, so "10:00+07:00" and "03:00Z" are the same time). The DTO checks the shape; this
 * checks what needs the clock. Every message names the field `proposedTimes` (400).
 */
export function parseProposedTimes(values: string[]): Date[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 3) {
    throw new BadRequestException('proposedTimes must have 1 to 3 times.');
  }
  const times = values.map((value) => new Date(value));
  if (times.some((time) => Number.isNaN(time.getTime()))) {
    throw new BadRequestException('proposedTimes must all be valid dates.');
  }
  const now = Date.now();
  if (times.some((time) => time.getTime() <= now)) {
    throw new BadRequestException('proposedTimes must all be in the future.');
  }
  const distinct = new Set(times.map((time) => time.getTime()));
  if (distinct.size !== times.length) {
    throw new BadRequestException('proposedTimes must all be different.');
  }
  return times;
}

/** "Wed 25 Nov 10:00, Thu 26 Nov 14:00 (online, 45 min) (Vietnam time)". */
export function interviewTimesText(
  times: Date[],
  details: Pick<Interview, 'mode' | 'durationMinutes' | 'location'>,
) {
  const how =
    details.mode === InterviewMode.ONSITE
      ? `onsite at ${details.location}`
      : details.mode === InterviewMode.PHONE
        ? 'by phone'
        : 'online';
  return `${times.map(formatVietnamTime).join(', ')} (${how}, ${details.durationMinutes} min) (Vietnam time)`;
}
