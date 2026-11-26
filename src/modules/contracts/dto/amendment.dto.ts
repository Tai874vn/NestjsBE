import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  Max,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  optionalTrimString,
  trimString,
} from '../../../common/dto/string.transforms';
import { AmendmentChangeParsed } from '../utils/contract-rules';
import { MAX_MILESTONE_CREDITS } from './proposal.dto';

export const AMENDMENT_OPS = ['add', 'move', 'amount'] as const;

/**
 * One change of an amendment. Which fields are needed depends on `op`:
 * add (title, dueDate, amount, description?), move (milestoneId, dueDate), amount (milestoneId, amount).
 * dueDate is ISO 8601 text (the app sends 23:59 local time).
 */
export class AmendmentChangeDto {
  @IsIn(AMENDMENT_OPS)
  op: (typeof AMENDMENT_OPS)[number];

  @ValidateIf((o: AmendmentChangeDto) => o.op === 'add')
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ValidateIf((o: AmendmentChangeDto) => o.op === 'move' || o.op === 'amount')
  @IsInt()
  @Min(1)
  milestoneId?: number;

  @ValidateIf((o: AmendmentChangeDto) => o.op === 'add' || o.op === 'move')
  @IsISO8601({ strict: true })
  dueDate?: string;

  /** Whole credits, 1 to 1,000,000. */
  @ValidateIf((o: AmendmentChangeDto) => o.op === 'add' || o.op === 'amount')
  @IsInt()
  @Min(1)
  @Max(MAX_MILESTONE_CREDITS)
  amount?: number;
}

/** Body of POST /contracts/:id/amendments: a note, an optional new deadline, 0 to 10 changes. */
export class CreateAmendmentDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  deadline?: string;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AmendmentChangeDto)
  changes: AmendmentChangeDto[];
}

/** Body of decline: an optional note (up to 1000 characters). */
export class DeclineAmendmentDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Turns the validated changes into the shape the rules read (dates become Date objects). */
export function parseAmendmentChanges(
  changes: AmendmentChangeDto[],
): AmendmentChangeParsed[] {
  return changes.map((c) => {
    if (c.op === 'add') {
      return {
        op: 'add',
        title: c.title!,
        ...(c.description ? { description: c.description } : {}),
        dueDate: new Date(c.dueDate!),
        amount: c.amount!,
      };
    }
    if (c.op === 'move') {
      return {
        op: 'move',
        milestoneId: c.milestoneId!,
        dueDate: new Date(c.dueDate!),
      };
    }
    return { op: 'amount', milestoneId: c.milestoneId!, amount: c.amount! };
  });
}

const CHOICES = ['APPROVE', 'REFUND'] as const;

/** Body of POST /contracts/:id/end-requests. */
export class CreateEndRequestDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** The client's pick for a SUBMITTED milestone: pay the freelancer or take the credits back. */
  @IsOptional()
  @IsIn(CHOICES)
  submittedChoice?: (typeof CHOICES)[number];
}

/** Body of POST /contracts/:id/end-requests/accept. */
export class AcceptEndRequestDto {
  @IsOptional()
  @IsIn(CHOICES)
  submittedChoice?: (typeof CHOICES)[number];
}
