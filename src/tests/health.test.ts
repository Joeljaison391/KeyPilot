import request from 'supertest';
import App from '../app';

describe('Health Routes', () => {
  let app: App;

  beforeAll(() => {
    app = new App();
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app.app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'OK');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('service');
      expect(response.body).toHaveProperty('version');
    });
  });

  describe('GET /health/ready', () => {
    it('should return readiness status', async () => {
      const response = await request(app.app)
        .get('/health/ready')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'Ready');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /health/live', () => {
    it('should return liveness status', async () => {
      const response = await request(app.app)
        .get('/health/live')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'Alive');
      expect(response.body).toHaveProperty('timestamp');
    });
  });
});
