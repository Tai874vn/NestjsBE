import { IsInt, Max, Min } from 'class-validator';
import {
  TOP_UP_MAX_CREDITS,
  TOP_UP_MIN_CREDITS,
} from '../services/wallet.service';

/** POST /wallet/top-ups — whole credits, 10 to 10,000 (Stripe test mode; price per credit is set in top-ups.service.ts). */
export class TopUpDto {
  @IsInt({ message: 'credits must be a whole number.' })
  @Min(TOP_UP_MIN_CREDITS, {
    message: `credits must be at least ${TOP_UP_MIN_CREDITS}.`,
  })
  @Max(TOP_UP_MAX_CREDITS, {
    message: `credits must be at most ${TOP_UP_MAX_CREDITS.toLocaleString('en-US')}.`,
  })
  credits: number;
}
