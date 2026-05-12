import { Body, Controller, Get, Post } from '@nestjs/common';
import { NacosService } from './nacos.service';

@Controller('nacos')
export class NacosController {
  constructor(private readonly nacosService: NacosService) {}

  @Post('reload')
  reload(@Body() body: { namespace: string; env: string }) {
    // Ejecutar la recarga de forma asíncrona y responder rápido
    this.nacosService.reload(body.namespace, body.env).catch((err) => {
      // El servicio ya registra el error; aquí se puede ampliar manejo si hace falta
      // no throw para responder accepted inmediatamente
    });

    return { status: 'accepted' };
  }

  @Get('status')
  status() {
    return this.nacosService.status();
  }
}
