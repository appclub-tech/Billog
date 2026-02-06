import {
  IsString,
  IsBoolean,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Channel } from '@prisma/client';

export class MemberInputDto {
  @IsString()
  channelId!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SyncMembersDto {
  @IsEnum(Channel)
  channel!: Channel;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MemberInputDto)
  members!: MemberInputDto[];
}
