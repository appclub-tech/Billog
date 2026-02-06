import { Controller, Get, Post, Patch, Query, Body, UseGuards, Logger } from '@nestjs/common';
import { UserService } from '../../services/user/user.service.js';
import { IdentityService } from '../../services/user/identity.service.js';
import { AuthGuard, GetUser, JwtPayload } from '../guards/auth.guard.js';
import { Channel } from '@prisma/client';
import { IsString, IsOptional, IsEnum } from 'class-validator';

class UpdateUserDto {
  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

class EnsureUserDto {
  @IsEnum(['LINE', 'WHATSAPP', 'TELEGRAM', 'DISCORD', 'WEB'])
  channel!: Channel;

  @IsString()
  channelId!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

@Controller('users')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private userService: UserService,
    private identityService: IdentityService,
  ) {}

  /**
   * Ensure user exists - creates user if not found
   * Called by gateway router on every message to ensure user account exists
   */
  @Post('ensure')
  @UseGuards(AuthGuard)
  async ensureUser(@Body() dto: EnsureUserDto) {
    const { user, identity, isNew } = await this.identityService.resolveIdentity(
      dto.channel,
      dto.channelId,
      dto.displayName,
    );

    if (isNew) {
      this.logger.log(`Created new user ${user.id} for ${dto.channel}:${dto.channelId}`);
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        language: user.language,
        timezone: user.timezone,
        isNew,
      },
    };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async getCurrentUser(@GetUser() jwtUser: JwtPayload) {
    if (!jwtUser.channel || !jwtUser.senderChannelId) {
      return { error: 'channel and senderChannelId are required in token' };
    }

    const user = await this.identityService.findUserByIdentity(
      jwtUser.channel,
      jwtUser.senderChannelId,
    );

    if (!user) {
      return { error: 'User not found' };
    }

    const sources = await this.userService.getUserSources(user.id);

    return {
      user: {
        id: user.id,
        name: user.name,
        timezone: user.timezone,
        language: user.language,
      },
      sources: sources.map((m) => m.source),
    };
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  async updateCurrentUser(
    @GetUser() jwtUser: JwtPayload,
    @Body() dto: UpdateUserDto,
  ) {
    if (!jwtUser.channel || !jwtUser.senderChannelId) {
      return { error: 'channel and senderChannelId are required in token' };
    }

    const user = await this.identityService.findUserByIdentity(
      jwtUser.channel,
      jwtUser.senderChannelId,
    );

    if (!user) {
      return { error: 'User not found' };
    }

    const updated = await this.userService.updateUser(user.id, {
      language: dto.language,
      timezone: dto.timezone,
      name: dto.name,
    });

    return {
      success: true,
      user: {
        id: updated.id,
        name: updated.name,
        timezone: updated.timezone,
        language: updated.language,
      },
    };
  }

  @Get('resolve')
  @UseGuards(AuthGuard)
  async resolveUser(
    @Query('channel') channel: string,
    @Query('channelId') channelId: string,
  ) {
    if (!channel || !channelId) {
      return { error: 'channel and channelId are required' };
    }

    const user = await this.identityService.findUserByIdentity(
      channel as Channel,
      channelId,
    );

    if (!user) {
      return { user: null };
    }

    return {
      user: {
        id: user.id,
        name: user.name,
      },
    };
  }
}
