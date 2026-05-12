import { Body, Controller, Get, Post } from '@nestjs/common';
import { NacosService } from './nacos.service';
import { RabbitService } from '../rabbit/rabbit.service';

@Controller('nacos')
export class NacosController {
  constructor(
    private readonly nacosService: NacosService,
    private readonly rabbitService: RabbitService,
  ) {}

  @Post('reload')
  async reload(
    @Body()
    body: { namespace: string; env: string; vhost?: string },
  ) {
    // recargar nacos
    await this.nacosService.reload(body.namespace, body.env);

    // actualizar rabbit dinámicamente
    await this.rabbitService.setConnectionConfig(
      body.namespace,
      body.env,
      body.vhost,
    );

    return {
      status: 'ok',
      namespace: body.namespace,
      env: body.env,
      vhost: body.vhost ?? '/',
    };
  }

  @Get('status')
  status() {
    return this.nacosService.status();
  }
}