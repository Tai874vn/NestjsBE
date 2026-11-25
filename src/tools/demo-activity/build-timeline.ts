import { between, type ActivityContext } from './activity-shared';

export type ActivityTimeline = {
  joinedAt: Map<number, Date>;
  serviceCreatedAt: Map<number, Date>;
  hiringPostCreatedAt: Map<number, Date>;
};

/**
 * Build the base timeline: people joined 50-90 days ago, and their services and hiring posts came after.
 */
export function buildTimeline(ctx: ActivityContext): ActivityTimeline {
  const { input, random, ago } = ctx;
  const joinedAt = new Map<number, Date>();
  for (const person of input.people) {
    joinedAt.set(person.id, ago(random.int(50, 90) + random.next()));
  }

  const serviceCreatedAt = new Map<number, Date>();
  for (const service of input.services) {
    serviceCreatedAt.set(
      service.id,
      between(random, joinedAt.get(service.creatorId) ?? ago(60), ago(30)),
    );
  }

  const hiringPostCreatedAt = new Map<number, Date>();
  for (const post of input.hiringPosts) {
    hiringPostCreatedAt.set(post.id, between(random, ago(35), ago(1)));
  }

  return { joinedAt, serviceCreatedAt, hiringPostCreatedAt };
}
