import { Injectable } from '@nestjs/common';
import { WinstonLoggerService } from '@crm4/logger';

@Injectable()
export class NacosService {
  constructor(
    private readonly logger: WinstonLoggerService,
  ) { }
  private reloaded = false;
  private lastReloadAt?: string;

  async reload(namespace: string, env: string): Promise<void> {
    this.reloaded = false;

    try {
      process.env.NACOS_NAMESPACE = namespace;
      process.env.NACOS_ENV = env;

      this.logger.logStructured('nacos.reload.started', {
        namespace,
        env,
      });

      await new Promise((r) => setTimeout(r, 1000));

      this.reloaded = true;
      this.lastReloadAt = new Date().toISOString();

      this.logger.logStructured('nacos.reload.completed', {
        namespace,
        env,
        reloadedAt: this.lastReloadAt,
      });
    } catch (err) {
      this.logger.logError(
        err instanceof Error ? err : new Error(String(err)),
        'NacosService.reload',
        {
          namespace,
          env,
        },
      );

      this.reloaded = false;
      throw err;
    }
  }

  // 👇 AQUI
  async getRabbitConfig(namespace: string, env: string, vhost?: string) {
    this.logger.logStructured('nacos.rabbit-config.requested', {
      namespace,
      env,
      vhost: vhost ?? '/',
    });

    const buildUrl = (baseUrl: string, requestedVhost?: string) => {
      const url = new URL(baseUrl);
      const normalized = requestedVhost?.trim() || '/';
      url.pathname = normalized === '/' ? '/' : normalized.startsWith('/') ? normalized : `/${normalized}`;
      return url.toString();
    };

    if (env === 'QAS' && namespace === '10000365') {
      return {
        url: buildUrl('amqp://admin:admin@swarm-qas.hansa.com.bo:40240', vhost),
        managementUrl: 'http://swarm-qas.hansa.com.bo:40241',
      };
    }

    if (env === 'QAS' && namespace === '10000291') {
      return {
        url: buildUrl('amqp://admin:admin@swarm-qas.hansa.com.bo:40585', vhost),
        managementUrl: 'http://swarm-qas.hansa.com.bo:40586',
      };
    }


    if (env === 'QAS' && namespace === '10000265') {
      return {
        url: buildUrl('amqp://admin:admin@swarm-qas.hansa.com.bo:40745', vhost),
        managementUrl: 'http://swarm-qas.hansa.com.bo:40746',
      };
    }

    //PRD
    if (env === 'PRD' && namespace === '10000365') {
      return {
        url: buildUrl('amqp://admin:admin@swarm.hansa.com.bo:40240', vhost),
        managementUrl: 'http://swarm.hansa.com.bo:40241',
      };
    }

    if (env === 'PRD' && namespace === '10000291') {
      return {
        url: buildUrl('amqp://admin:admin@swarm.hansa.com.bo:40585', vhost),
        managementUrl: 'http://swarm.hansa.com.bo:40586',
      };
    }

    // if (env === 'QAS' && namespace === '10000265') {
    //   return {
    //     url: 'amqp://admin:admin@swarm.hansa.com.bo:40745/internal',
    //     managementUrl: 'http://swarm.hansa.com.bo:40746',
    //   };
    // }

    // fallback
    return {
      url: buildUrl('amqp://user:password@localhost:5672', vhost),
      managementUrl: 'http://localhost:15672',
    };
  }

  status() {
    return {
      reloaded: this.reloaded,
      timestamp: this.lastReloadAt,
    };
  }
}