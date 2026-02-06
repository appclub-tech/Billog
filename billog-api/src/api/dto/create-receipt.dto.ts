import {
  IsString,
  IsNumber,
  IsOptional,
  IsObject,
  IsDateString,
  Min,
} from 'class-validator';

export class CreateReceiptDto {
  @IsString()
  expenseId!: string; // Required - receipts are created AFTER expenses

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
  @IsDateString()
  receiptDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  subtotal?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  total?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsObject()
  rawOcrData?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  confidence?: number;
}
