import { RabbitService } from './rabbit.service';

describe('RabbitService', () => {
  it('returns configured defaults', () => {
    const service = new RabbitService();

    expect(service.getDefaults().url).toBeTruthy();
    expect(service.getDefaults().prefetch).toBeGreaterThan(0);
  });
});
