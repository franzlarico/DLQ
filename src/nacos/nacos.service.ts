import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class NacosService {
  private reloaded = false;
  private lastReloadAt?: string;
  private readonly logger = new Logger(NacosService.name);

  async reload(namespace: string, env: string): Promise<void> {
    this.reloaded = false;
    try {
      process.env.NACOS_NAMESPACE = namespace;
      process.env.NACOS_ENV = env;

      this.logger.log(`Iniciando recarga Nacos namespace=${namespace} env=${env}`);

      // TODO: Integrar aquí el cliente Nacos real para forzar la recarga de configuración.
      // Ejemplo: await this.nacosClient.reloadConfig({ namespace, env });

      // Simulación mínima para indicar trabajo realizado
      await new Promise((r) => setTimeout(r, 1000));

      this.reloaded = true;
      this.lastReloadAt = new Date().toISOString();
      this.logger.log('Recarga Nacos completada');
    } catch (err) {
      this.logger.error('Fallo recargando Nacos', err as Error);
      this.reloaded = false;
      throw err;
    }
  }

  status() {
    return { reloaded: this.reloaded, timestamp: this.lastReloadAt };
  }
}
