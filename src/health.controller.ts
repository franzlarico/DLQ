import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check(): { ok: true; service: string; timestamp: string } {
    return {
      ok: true,
      service: 'rabbit-dlq-console-api',
      timestamp: new Date().toISOString(),
    };
  }
}
