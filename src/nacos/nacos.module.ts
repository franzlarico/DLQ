import { Module } from '@nestjs/common';
import { NacosController } from './nacos.controller';
import { NacosService } from './nacos.service';
import { RabbitModule } from 'src/rabbit/rabbit.module';

@Module({
    imports: [RabbitModule],
    controllers: [NacosController],
    providers: [NacosService],
    exports: [NacosService],
})
export class NacosModule { }