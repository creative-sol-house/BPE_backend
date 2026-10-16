// routes/leadRoutes.ts
import { Router } from 'express';
import * as leadController from '../controller/leadController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const leadRouter = Router();

leadRouter.use(authenticate);

// ═════════════════════════════════════════════════════════════════════════
// SPECIFIC ROUTES FIRST (must come before /:leadId)
// ═════════════════════════════════════════════════════════════════════════

leadRouter.get(
  '/stats',
  authorize('leads', 'view'),
  leadController.getLeadStats
);

leadRouter.get(
  '/pipeline',
  authorize('leads', 'view'),
  leadController.getLeadPipeline
);

// ═════════════════════════════════════════════════════════════════════════
// GENERIC LIST / CREATE
// ═════════════════════════════════════════════════════════════════════════

leadRouter.get(
  '/',
  authorize('leads', 'view'),
  leadController.listLeads
);

leadRouter.post(
  '/',
  authorize('leads', 'add'),
  leadController.createLead
);

// ═════════════════════════════════════════════════════════════════════════
// GET / UPDATE ONE (accepts _id or "LEAD-XXXXX")
// ═════════════════════════════════════════════════════════════════════════

leadRouter.get(
  '/:leadId',
  authorize('leads', 'view'),
  leadController.getLead
);

leadRouter.patch(
  '/:leadId',
  authorize('leads', 'edit'),
  leadController.updateLead
);

// ═════════════════════════════════════════════════════════════════════════
// ASSIGNMENT / FOLLOW-UP / STATUS
// ═════════════════════════════════════════════════════════════════════════

leadRouter.patch(
  '/:leadId/assign',
  authorize('leads', 'edit'),
  leadController.assignLead
);

leadRouter.patch(
  '/:leadId/follow-up',
  authorize('leads', 'edit'),
  leadController.scheduleFollowUp
);

leadRouter.patch(
  '/:leadId/status',
  authorize('leads', 'edit'),
  leadController.changeLeadStatus
);

// ═════════════════════════════════════════════════════════════════════════
// CONVERT → CLIENT
// body: { existingClientId?, clientType?, tier?, paymentTerms?, ... }
// Requires leads:edit AND (clients:add when creating a new client)
// ═════════════════════════════════════════════════════════════════════════

leadRouter.post(
  '/:leadId/convert',
  authorize('leads', 'edit'),
  leadController.convertLead
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ACTIVITIES
// ═════════════════════════════════════════════════════════════════════════

leadRouter.post(
  '/:leadId/activities',
  authorize('leads', 'edit'),
  leadController.addLeadActivity
);

leadRouter.delete(
  '/:leadId/activities/:activityId',
  authorize('leads', 'edit'),
  leadController.removeLeadActivity
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ATTACHMENTS
// ═════════════════════════════════════════════════════════════════════════

leadRouter.post(
  '/:leadId/attachments',
  authorize('leads', 'edit'),
  leadController.addLeadAttachment
);

leadRouter.delete(
  '/:leadId/attachments/:attachmentId',
  authorize('leads', 'edit'),
  leadController.removeLeadAttachment
);

// ═════════════════════════════════════════════════════════════════════════
// SOFT DELETE / RESTORE
// ═════════════════════════════════════════════════════════════════════════

leadRouter.delete(
  '/:leadId',
  authorize('leads', 'delete'),
  leadController.deleteLead
);

leadRouter.post(
  '/:leadId/restore',
  authorize('leads', 'edit'),
  leadController.restoreLead
);

export default leadRouter;