import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  Min,
} from 'class-validator';
import { Channel } from '@prisma/client';

export class CreateSettlementDto {
  @IsEnum(Channel)
  channel!: Channel;

  @IsString()
  sourceChannelId!: string;

  @IsString()
  senderChannelId!: string;

  @IsString()
  fromChannelId!: string;

  @IsString()
  toChannelId!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  paymentMethod?: number;
}
