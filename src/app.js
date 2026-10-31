import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { id } from './utils/core.js';
import { authenticate, csrf, tenantContext, requireTenant } from './middleware/index.js';
import healthRoutes from './routes/healthRoutes.js';
import publicSellerRoutes from './routes/publicSellerRoutes.js';
import storefrontRoutes from './routes/storefrontRoutes.js';
import authRoutes from './routes/authRoutes.js';
import publicLeadSettingsRoutes from './routes/publicLeadSettingsRoutes.js';
import dealerRoutes from './routes/dealerRoutes.js';
import activityRoutes from './routes/activityRoutes.js';
import userRoutes from './routes/userRoutes.js';
import vehicleRoutes from './routes/vehicleRoutes.js';
import enquiryRoutes from './routes/enquiryRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import inspectionRoutes from './routes/inspectionRoutes.js';
import parkingRoutes from './routes/parkingRoutes.js';
import acquisitionRoutes from './routes/acquisitionRoutes.js';
import refurbishmentRoutes from './routes/refurbishmentRoutes.js';
import resaleRoutes from './routes/resaleRoutes.js';
import reportingRoutes from './routes/reportingRoutes.js';
import lifecycleRoutes from './routes/lifecycleRoutes.js';
import portalRoutes from './routes/portalRoutes.js';
import profileRoutes from './routes/profileRoutes.js';

const app = express();

app.use((req, res, next) => {
  if (req.url === '/api/v1' || req.url.startsWith('/api/v1/')) req.url = `/api${req.url.slice(7)}` || '/api';
  next();
});
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan(':method :url :status :response-time ms'));
app.use((req, res, next) => {
  req.requestId = id('REQ');
  res.set('x-request-id', req.requestId);
  next();
});

app.use('/api', healthRoutes);
app.use('/api', publicSellerRoutes);
app.use('/api', storefrontRoutes);
app.use('/api', authRoutes);
app.use('/api', (req, res, next) =>
  ['/auth/password-reset/request', '/auth/password-reset/confirm', '/auth/invitations/accept'].includes(req.path)
    ? next()
    : authenticate(req, res, (error) => (error ? next(error) : csrf(req, res, next)))
);
app.use('/api', tenantContext);
app.use('/api', (req, res, next) => {
  if (!req.user) return next();
  const platformRoute =
    req.path === '/dealers' || req.path.startsWith('/dealers/') ||
    req.path === '/users' || req.path.startsWith('/users/') ||
    req.path === '/activity' || req.path === '/public-lead-settings';
  if (req.user.role === 'Super Admin' && platformRoute) return next();
  return requireTenant(req, res, next);
});

app.use('/api', publicLeadSettingsRoutes);
app.use('/api', dealerRoutes);
app.use('/api', activityRoutes);
app.use('/api', inspectionRoutes);
app.use('/api', parkingRoutes);
app.use('/api', acquisitionRoutes);
app.use('/api', refurbishmentRoutes);
app.use('/api', resaleRoutes);
app.use('/api', reportingRoutes);
app.use('/api', lifecycleRoutes);
app.use('/api', portalRoutes);
app.use('/api', profileRoutes);
app.use('/api', userRoutes);
app.use('/api', vehicleRoutes);
app.use('/api', enquiryRoutes);
app.use('/api', documentRoutes);
app.use('/api', dashboardRoutes);

app.use((error, req, res, next) => {
  const status =
    error.status ||
    error.statusCode ||
    (error.name === 'MulterError'
      ? 400
      : ['ZodError', 'CastError', 'ValidationError'].includes(error.name)
        ? 400
        : 500);
  console.error(JSON.stringify({ level: 'error', requestId: req.requestId, status, message: error.message }));
  res.status(status).json({
    error: {
      message: status === 500 ? 'Unexpected server error' : error.message || 'Request failed',
      requestId: req.requestId,
    },
  });
});

export default app;
