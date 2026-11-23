import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { LEDGER_MAX_PAGE_SIZE } from '../wallet.service';

/** GET /wallet/ledger?page&pageSize — pageSize is at most 50. */
export class WalletLedgerQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LEDGER_MAX_PAGE_SIZE)
  pageSize: number = 20;
}
