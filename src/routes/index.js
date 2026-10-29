import healthRoutes from './healthRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';

export function registerRoutes(app) {
  app.use('/api', healthRoutes);
  app.use('/api', dashboardRoutes);
}
