import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Channel } from '@prisma/client';

export type AdjustmentType =
  | 'reassign_item'
  | 'update_item'
  | 'add_item'
  | 'remove_item'
  | 'remove_from_split'
  | 'add_to_split'
  | 'update_amount'
  | 'update_category'
  | 'update_description';

export class AdjustmentDto {
  @IsString()
  type!: AdjustmentType;

  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  target?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ReconcileExpenseDto {
  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @IsOptional()
  @IsString()
  sourceChannelId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdjustmentDto)
  adjustments!: AdjustmentDto[];

  @IsOptional()
  @IsString()
  reason?: string;
}
