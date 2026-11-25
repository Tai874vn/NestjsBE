import { interviewTimesText } from '../../modules/hiring-pipeline/interview-times';
import type { ChatLineFact } from './build-contracts';
import {
  after,
  firstName,
  years,
  type Activity,
  type ActivityContext,
  type HiringPostFact,
  type Person,
} from './activity-shared';

type ChatRoom = Activity['chats'][number];
type ChatLine = [senderId: number, content: string, createdAt: Date];
type ChatLookup = (first: number, second: number, start: Date) => ChatRoom;

const PIPELINE_CHAT_STATUSES = ['INTERVIEWING', 'OFFERED', 'HIRED'];

/**
 * Build direct message rooms from three sources in order:
 * 1. recruiter-applicant chats, 2. connected peer chats, 3. proposal/contract system chat lines.
 */
export function buildChats(
  ctx: ActivityContext,
  applications: Activity['applications'],
  connections: Activity['connections'],
  contractChatLines: ChatLineFact[],
): Activity['chats'] {
  const chats = new Map<string, ChatRoom>();
  const chatWith: ChatLookup = (first, second, start) => {
    const key = [first, second].sort((a, b) => a - b).join(':');
    const chat = chats.get(key) ?? {
      members: [first, second] as [number, number],
      createdAt: start,
      messages: [],
    };
    chats.set(key, chat);
    return chat;
  };

  addApplicationChats(ctx, applications, chatWith);
  addPeerChats(ctx, connections, chatWith);
  addContractChats(contractChatLines, chatWith);
  return finalizeChats(chats);
}

function addApplicationChats(
  ctx: ActivityContext,
  applications: Activity['applications'],
  chatWith: ChatLookup,
): void {
  const { random, people, postById } = ctx;
  for (const application of applications) {
    const reviewing = application.status === 'REVIEWING' && random.chance(0.5);
    const inPipeline = PIPELINE_CHAT_STATUSES.includes(application.status);
    if (!inPipeline && !reviewing) continue;

    const post = postById.get(application.hiringPostId)!;
    const candidate = people.get(application.applicantId)!;
    const lines = inPipeline
      ? buildPipelineChatLines(ctx, application, post, candidate)
      : buildReviewingChatLines(ctx, application, post, candidate);

    const chat = chatWith(post.recruiterId, candidate.id, lines[0][2]);
    for (const [senderId, content, createdAt] of lines) {
      chat.messages.push({ senderId, content, createdAt });
    }
  }
}

function buildPipelineChatLines(
  ctx: ActivityContext,
  application: Activity['applications'][number],
  post: HiringPostFact,
  candidate: Person,
): ChatLine[] {
  const { random, now } = ctx;
  const first = application.interviews[0];
  const requestedAt = first.createdAt;
  const lines: ChatLine[] = [
    [
      post.recruiterId,
      `Interview request for ${post.title}: ${interviewTimesText(first.proposedTimes, first)}`,
      requestedAt,
    ],
    [
      candidate.id,
      first.status === 'PROPOSED'
        ? `Thank you! I will pick a time today.`
        : `Thank you! I picked a time that works for me.`,
      after(random, requestedAt, 0.2, 12, now),
    ],
  ];
  if (application.offeredAt && application.offerNote) {
    lines.push(
      [
        post.recruiterId,
        `Offer for ${post.title}: ${application.offerNote}`,
        application.offeredAt,
      ],
      application.decidedAt
        ? [
            candidate.id,
            `That is great news, I accept the offer. Thank you!`,
            application.decidedAt,
          ]
        : [
            candidate.id,
            `That is great news, thank you! I will read it tonight.`,
            after(random, application.offeredAt, 1, 20, now),
          ],
    );
  }
  return lines;
}

function buildReviewingChatLines(
  ctx: ActivityContext,
  application: Activity['applications'][number],
  post: HiringPostFact,
  candidate: Person,
): ChatLine[] {
  const { random, now } = ctx;
  const skill =
    post.skills.find((item) => candidate.skills.includes(item)) ??
    post.skills[0] ??
    'this kind of work';
  let at = application.updatedAt;
  const next = (): Date => (at = after(random, at, 0.2, 30, now));
  const lines: ChatLine[] = [
    [
      post.recruiterId,
      `Hi ${firstName(candidate)}, we are reviewing your application for ${post.title}. Quick question: how much of your recent work has been with ${skill}?`,
      next(),
    ],
    [
      candidate.id,
      `Hi! Most of my last ${years(Math.max(1, Math.min(candidate.years, 3)))}. Happy to show examples.`,
      next(),
    ],
  ];
  if (random.chance(0.5)) {
    lines.push([
      post.recruiterId,
      'Thanks, that helps. We will get back to you this week.',
      next(),
    ]);
  }
  return lines;
}

function addPeerChats(
  ctx: ActivityContext,
  connections: Activity['connections'],
  chatWith: ChatLookup,
): void {
  const { random, now, people } = ctx;
  const peerPairs = random
    .shuffle(
      connections.filter(
        (connection) =>
          connection.status === 'ACCEPTED' &&
          people.get(connection.requesterId)!.kind === 'candidate' &&
          people.get(connection.recipientId)!.kind === 'candidate',
      ),
    )
    .slice(0, 15);

  for (const pair of peerPairs) {
    const [first, second] = [
      people.get(pair.requesterId)!,
      people.get(pair.recipientId)!,
    ];
    const chat = chatWith(first.id, second.id, pair.updatedAt);
    const skill =
      second.skills.find((item) => first.skills.includes(item)) ??
      second.skills[0] ??
      'your stack';
    let at = pair.updatedAt;
    for (const [senderId, content] of [
      [
        first.id,
        `Hi ${firstName(second)}, thanks for connecting! I saw you work with ${skill} too.`,
      ],
      [second.id, `Hi! Yes, every day. Are you using it at work?`],
      [
        first.id,
        `Mostly on side projects for now. Mind if I ask you a few questions later?`,
      ],
    ] as Array<[number, string]>) {
      at = after(random, at, 0.3, 20, now);
      chat.messages.push({ senderId, content, createdAt: at });
    }
  }
}

/** Append the system chat lines the app writes for proposals and milestones. */
function addContractChats(
  contractChatLines: ChatLineFact[],
  chatWith: ChatLookup,
): void {
  for (const line of contractChatLines) {
    chatWith(line.fromId, line.toId, line.createdAt).messages.push({
      senderId: line.fromId,
      content: line.text,
      createdAt: line.createdAt,
    });
  }
}

function finalizeChats(chats: Map<string, ChatRoom>): Activity['chats'] {
  return [...chats.values()]
    .filter((chat) => chat.messages.length)
    .map((chat) => {
      // Messages in the order they were sent; the room starts with the first one.
      const messages = [...chat.messages].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      return {
        ...chat,
        messages,
        createdAt: new Date(
          Math.min(chat.createdAt.getTime(), messages[0].createdAt.getTime()),
        ),
      };
    });
}
