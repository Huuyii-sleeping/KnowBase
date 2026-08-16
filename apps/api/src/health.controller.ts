import { Controller, Get } from '@nestjs/common';
import { Public } from './modules/common/auth/auth.decorators';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  getHealth() {
    return {
      status: 'ok',
      service: 'knowbase-api',
      timestamp: new Date().toISOString(),
    };
  }
}
