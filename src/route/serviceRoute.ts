// routes/serviceRoute.ts
import { Router } from 'express';
import * as serviceController from '../controller/serviceController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const serviceRouter = Router();

serviceRouter.use(authenticate);

// ═════════════════════════════════════════════════════════════════════════
// SPECIFIC ROUTES FIRST (must come before /:serviceId)
// ═════════════════════════════════════════════════════════════════════════

// Lightweight options for dropdowns / ComboField
// Note: authorize against `leads:view` too — this powers the Lead form's
// service picker, and lead-only users should be able to fetch it.
serviceRouter.get(
  '/options',
  authorize('services', 'view'),
  serviceController.listServiceOptions
);

// ═════════════════════════════════════════════════════════════════════════
// GENERIC LIST / CREATE
// ═════════════════════════════════════════════════════════════════════════

serviceRouter.get(
  '/',
  authorize('services', 'view'),
  serviceController.listServices
);

serviceRouter.post(
  '/',
  authorize('services', 'add'),
  serviceController.createService
);

// ═════════════════════════════════════════════════════════════════════════
// GET / UPDATE ONE (accepts _id or "SVC-XXXXX")
// ═════════════════════════════════════════════════════════════════════════

serviceRouter.get(
  '/:serviceId',
  authorize('services', 'view'),
  serviceController.getService
);

serviceRouter.patch(
  '/:serviceId',
  authorize('services', 'edit'),
  serviceController.updateService
);

serviceRouter.patch(
  '/:serviceId/status',
  authorize('services', 'edit'),
  serviceController.changeServiceStatus
);

serviceRouter.delete(
  '/:serviceId',
  authorize('services', 'delete'),
  serviceController.deleteService
);

serviceRouter.post(
  '/:serviceId/restore',
  authorize('services', 'edit'),
  serviceController.restoreService
);

export default serviceRouter;