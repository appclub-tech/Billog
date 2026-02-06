import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  IsObject,
  IsDateString,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Channel, SourceType } from '@prisma/client';

export class SplitTargetDto {
  @IsString()
  target!: string; // '@all' | '@nickname' | channelId

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  percentage?: number;
}

export class ExpenseItemDto {
  @IsString()
  name!: string; // English name (default)

  @IsOptional()
  @IsString()
  nameLocalized?: string; // Original language (Thai, Japanese, etc.)

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsString()
  ingredientType?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}

export class GroupMemberDto {
  @IsString()
  channelId!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

/**
 * Receipt data from OCR extraction
 * Used to create Receipt record after Expense is created
 */
export class ReceiptDataDto {
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  storeName?: string;

  @IsOptional()
  @IsString()
  storeAddress?: string;

  @IsOptional()
  @IsNumber()
  subtotal?: number;

  @IsOptional()
  @IsNumber()
  tax?: number;

  @IsOptional()
  @IsNumber()
  total?: number;

  @IsOptional()
  @IsObject()
  rawOcrData?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  confidence?: number;
}

export class CreateExpenseDto {
  @IsEnum(Channel)
  channel!: Channel;

  @IsString()
  senderChannelId!: string;

  @IsOptional()
  @IsString()
  sourceChannelId?: string;

  @IsOptional()
  @IsEnum(SourceType)
  sourceType?: SourceType;

  @IsString()
  description!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsEnum(['equal', 'exact', 'percentage', 'item'])
  splitType?: 'equal' | 'exact' | 'percentage' | 'item';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SplitTargetDto)
  splits?: SplitTargetDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpenseItemDto)
  items?: ExpenseItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupMemberDto)
  groupMembers?: GroupMemberDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  date?: string; // Transaction date from receipt (YYYY-MM-DD), defaults to now

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>; // Payment info, receipt metadata, etc.

  @IsOptional()
  @ValidateNested()
  @Type(() => ReceiptDataDto)
  receiptData?: ReceiptDataDto; // OCR data - Receipt created AFTER expense
}
