import { Logger } from '@nestjs/common';
import { NacosConfigClient } from 'nacos';

export const EnvConfiguration = async () => {
  const logger = new Logger('NacosConfig');
  const nacosGroup = 'DEFAULT_GROUP';

  if (!process.env.NACOS_SERVERADDR) {
    throw new Error('NACOS_SERVERADDR no está definido');
  }

  if (!process.env.NACOS_ENV) {
    throw new Error('NACOS_ENV no está definido');
  }

  const configClient = new NacosConfigClient({
    serverAddr: process.env.NACOS_SERVERADDR,
    namespace: process.env.NACOS_NAMESPACE || '',
    identityKey: process.env.NACOS_IDENTITYKEY,
    identityValue: process.env.NACOS_IDENTITYVALUE,
  });

  try {
    logger.log('Conectando a Nacos...');

    await configClient.ready();

    const content = await configClient.getConfig(
      process.env.NACOS_ENV,
      nacosGroup,
    );

    if (!content) {
      logger.warn('No se encontró configuración en Nacos');
      return {};
    }

    const parsedConfig = JSON.parse(content);

    for (const key in parsedConfig) {
      const value = parsedConfig[key];

      process.env[key] =
        typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    }

    logger.log(
      `Configuración cargada: ${Object.keys(parsedConfig).length} variables`,
    );

    return parsedConfig;
  } catch (error) {
    logger.error(`Error conectando a Nacos: ${String(error)}`);
    logger.warn('Usando .env como fallback');

    return {};
  }
};