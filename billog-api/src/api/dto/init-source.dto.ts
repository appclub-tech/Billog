import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Channel, SourceType } from '@prisma/client';

export class MemberInput {
  @IsString()
  channelId!: string;

  @IsString()
  @IsOptional()
  displayName?: string;
}

export class InitSourceDto {
  @IsEnum(Channel)
  channel!: Channel;

  @IsString()
  sourceChannelId!: string;

  @IsEnum(SourceType)
  @IsOptional()
  sourceType?: SourceType;

  @IsString()
  @IsOptional()
  sourceName?: string;

  @IsString()
  senderChannelId!: string;

  @IsString()
  @IsOptional()
  senderDisplayName?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MemberInput)
  @IsOptional()
  members?: MemberInput[];

  @IsString()
  @IsOptional()
  currency?: string;
}
