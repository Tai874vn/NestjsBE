import {
  RELATED_FROM,
  after,
  between,
  occupationFit,
  type Activity,
  type ActivityContext,
} from './activity-shared';

const CONNECTED_PIPELINE_STATUSES = [
  'HIRED',
  'OFFERED',
  'INTERVIEWING',
  'REVIEWING',
];

export type ConnectionsActivity = {
  connections: Activity['connections'];
  friends: Map<number, number[]>;
};

/**
 * Build connections between peers in the same or related occupations, plus recruiters with the
 * candidates they shortlisted. Also returns the accepted friends map for feed posts and chats.
 */
export function buildConnections(
  ctx: ActivityContext,
  joinedAt: Map<number, Date>,
  applications: Activity['applications'],
): ConnectionsActivity {
  const { random, now, related, candidates, postById, ago } = ctx;
  const connections = new Map<string, Activity['connections'][number]>();

  const connect = (
    requesterId: number,
    recipientId: number,
    earliest: Date,
    acceptedChance: number,
  ) => {
    const key = [requesterId, recipientId].sort((a, b) => a - b).join(':');
    if (requesterId === recipientId || connections.has(key)) return;
    const start = new Date(
      Math.max(
        earliest.getTime(),
        joinedAt.get(requesterId)!.getTime(),
        joinedAt.get(recipientId)!.getTime(),
      ),
    );
    const createdAt = between(random, start, now);
    const status = random.chance(acceptedChance) ? 'ACCEPTED' : 'PENDING';
    connections.set(key, {
      requesterId,
      recipientId,
      status,
      createdAt,
      updatedAt:
        status === 'ACCEPTED'
          ? after(random, createdAt, 1, 48, now)
          : createdAt,
    });
  };

  // Candidate-to-candidate peer connections run first, then recruiter-to-applicant connections.
  for (const candidate of candidates) {
    const peers = candidates.filter(
      (other) =>
        other.id !== candidate.id &&
        occupationFit(candidate.occupation, other.occupation, related) >=
          RELATED_FROM,
    );
    for (const peer of random.shuffle(peers).slice(0, random.int(1, 4))) {
      connect(candidate.id, peer.id, ago(90), 0.8);
    }
    if (random.chance(0.3)) {
      connect(candidate.id, random.pick(candidates).id, ago(90), 0.6);
    }
  }

  for (const application of applications) {
    if (CONNECTED_PIPELINE_STATUSES.includes(application.status)) {
      connect(
        postById.get(application.hiringPostId)!.recruiterId,
        application.applicantId,
        application.updatedAt,
        0.85,
      );
    }
  }

  const list = [...connections.values()];
  return { connections: list, friends: indexAcceptedFriends(list) };
}

function indexAcceptedFriends(
  connections: Activity['connections'],
): Map<number, number[]> {
  const friends = new Map<number, number[]>();
  for (const connection of connections) {
    if (connection.status !== 'ACCEPTED') continue;
    friends.set(connection.requesterId, [
      ...(friends.get(connection.requesterId) ?? []),
      connection.recipientId,
    ]);
    friends.set(connection.recipientId, [
      ...(friends.get(connection.recipientId) ?? []),
      connection.requesterId,
    ]);
  }
  return friends;
}
