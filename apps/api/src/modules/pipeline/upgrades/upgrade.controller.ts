import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/auth/auth.decorators';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../auth/auth.types';
import { UserRole } from '../../users/entities/user.entity';
import { CreateUpgradeDto, UpgradePageDto } from './upgrade.dto';
import { UpgradeManagementService } from './upgrade-management.service';
import { UpgradeAction } from './upgrade-command.service';
const ACTIONS = {
  start: 'start',
  pause: 'pause',
  resume: 'resume',
  cancel: 'cancel',
  retry: 'retry',
};
@Controller('index-upgrades')
@Roles(UserRole.ADMIN)
export class UpgradeController {
  constructor(private readonly management: UpgradeManagementService) {}
  @Post() create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateUpgradeDto,
  ) {
    return this.management.create(user, body);
  }
  @Get() list(@CurrentUser() user: AuthUser) {
    return this.management.list(user);
  }
  @Get(':id') summary(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.management.summary(user, id);
  }
  @Get(':id/items') items(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: UpgradePageDto,
  ) {
    return this.management.items(user, id, query.after, query.limit);
  }
  @Get(':id/tasks/:taskId/attempts') attempts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.management.attempts(user, id, taskId);
  }
  @Post(':id/tasks/:taskId/retry')
  @HttpCode(202)
  retryTask(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.management.command(user, id, 'retry', taskId);
  }
  @Post(':id/:action')
  @HttpCode(202)
  command(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action', new ParseEnumPipe(ACTIONS)) action: UpgradeAction,
  ) {
    return this.management.command(user, id, action);
  }
}
