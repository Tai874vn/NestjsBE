import {
  buildContracts,
  serviceTermsFor,
  type ContractPair,
  type ServiceTerms,
} from './build-contracts';
import {
  between,
  firstName,
  occupationFit,
  randomGenerator,
  type Activity,
  type ActivityContext,
  type Level,
  type Person,
  type Random,
  type ServiceFact,
} from './activity-shared';

export type ServicesAndContractsActivity = {
  serviceTerms: Map<number, ServiceTerms>;
  savedJobs: Activity['savedJobs'];
  work: ReturnType<typeof buildContracts>;
};

/**
 * Build service pricing/terms, saved services, proposals, contracts, wallets and ledger rows.
 * Pair selection runs before pricing terms, and buildContracts runs last with the shuffled pairs.
 */
export function buildServicesAndContracts(
  ctx: ActivityContext,
  joinedAt: Map<number, Date>,
  serviceCreatedAt: Map<number, Date>,
): ServicesAndContractsActivity {
  const { input, random, now } = ctx;
  const { pairs, savedJobs } = collectServicePairsAndSavedJobs(
    ctx,
    joinedAt,
    serviceCreatedAt,
  );
  const serviceTerms = buildServiceTerms(ctx, pairs);
  const work = buildContracts({
    pairs: random.shuffle(pairs),
    terms: serviceTerms,
    people: input.people,
    joinedAt,
    now,
    graceMinutes: input.graceMinutes ?? 4320,
    random,
    makeRandom: randomGenerator,
    review: buildServiceReview,
  });
  return { serviceTerms, savedJobs, work };
}

/** Match recruiters (and a few candidates) with services in matching occupations to buy or save. */
function collectServicePairsAndSavedJobs(
  ctx: ActivityContext,
  joinedAt: Map<number, Date>,
  serviceCreatedAt: Map<number, Date>,
): { pairs: ContractPair[]; savedJobs: Activity['savedJobs'] } {
  const { input, random, now, related, people, candidates, recruiters } = ctx;
  const pairs: ContractPair[] = [];
  const savedJobs: Activity['savedJobs'] = [];
  const hirers = [
    ...recruiters,
    ...candidates.filter(() => random.chance(0.12)),
  ];

  for (const hirer of hirers) {
    const wanted =
      hirer.kind === 'recruiter'
        ? input.hiringPosts
            .filter((post) => post.recruiterId === hirer.id)
            .map((post) => post.occupationCode)
        : [hirer.occupation];
    const options = input.services.filter((service) => {
      const creator = people.get(service.creatorId);
      return (
        creator &&
        creator.id !== hirer.id &&
        wanted.some(
          (code) => occupationFit(code, creator.occupation, related) >= 0.3,
        )
      );
    });
    const shuffled = random.shuffle(options);
    const buyCount = random.int(
      hirer.kind === 'recruiter' ? 1 : 0,
      hirer.kind === 'recruiter' ? 3 : 1,
    );
    for (const service of shuffled.slice(0, buyCount)) {
      const serviceAt = serviceCreatedAt.get(service.id)!.getTime();
      pairs.push({
        client: hirer,
        service,
        freelancer: people.get(service.creatorId)!,
        earliest: new Date(
          Math.max(serviceAt, joinedAt.get(hirer.id)!.getTime()),
        ),
      });
    }
    for (const service of shuffled.slice(3, 3 + random.int(0, 2))) {
      savedJobs.push({
        userId: hirer.id,
        jobId: service.id,
        createdAt: between(random, serviceCreatedAt.get(service.id)!, now),
      });
    }
  }

  return { pairs, savedJobs };
}

/** Price every service that someone buys, plus about half of the remaining services. */
function buildServiceTerms(
  ctx: ActivityContext,
  pairs: ContractPair[],
): Map<number, ServiceTerms> {
  const { input, random, people } = ctx;
  const serviceTerms = new Map<number, ServiceTerms>();
  const bought = new Set(pairs.map((pair) => pair.service.id));
  for (const service of input.services) {
    const freelancer = people.get(service.creatorId);
    if (freelancer && (bought.has(service.id) || random.chance(0.5))) {
      serviceTerms.set(service.id, serviceTermsFor(random, freelancer));
    }
  }
  return serviceTerms;
}

function buildServiceReview(
  generator: Random,
  freelancer: Person,
  service: ServiceFact,
): { rating: number; content: string } {
  const rating = generator.pick(RATINGS[freelancer.level ?? 'Mid']);
  const skill = freelancer.skills.length
    ? generator.pick(freelancer.skills)
    : 'the work';
  return {
    rating,
    content: generator.pick(REVIEWS[rating])(
      service.title,
      skill,
      firstName(freelancer),
    ),
  };
}

const RATINGS: Record<Level, number[]> = {
  Junior: [3, 4, 4, 5],
  Mid: [4, 4, 5, 5],
  Senior: [4, 5, 5, 5],
};

const REVIEWS: Record<
  number,
  Array<(title: string, skill: string, name: string) => string>
> = {
  5: [
    (title, skill, name) =>
      `${name} delivered "${title}" on time with clear updates. Strong ${skill} work. Would hire again.`,
    (title, _skill, name) =>
      `Excellent job on "${title}". ${name} understood what we needed after one call.`,
  ],
  4: [
    (title, skill) =>
      `Good work on "${title}". Solid ${skill}; one round of changes and it was done.`,
    (title, _skill, name) =>
      `${name} did a reliable job on "${title}". A little slower than planned, but the result was good.`,
  ],
  3: [
    (title, skill) =>
      `"${title}" was finished, but it needed a few rounds of fixes. ${skill} basics are there.`,
  ],
};
