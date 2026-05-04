import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns service health', () => {
    const controller = new HealthController();

    expect(controller.check()).toMatchObject({
      ok: true,
      service: 'rabbit-dlq-console-api',
    });
  });
});
