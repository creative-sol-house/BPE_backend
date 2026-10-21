// routes/requestRoutes.ts
import { Router } from 'express';
import * as ctrl from '../controller/requestController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();
router.use(authenticate);

// ─── Stats (scoped: admin sees all, employee sees own) ──────────────────
router.get('/stats', ctrl.requestStats);

// ═════════════════════════════════════════════════════════════════════════
// SELF-SERVICE — employees submit/edit/cancel their own requests.
// Controllers scope to req.user._id via isSubmitter checks.
// ═════════════════════════════════════════════════════════════════════════

// Submit a new request (self, or on-behalf if user has requests:edit)
router.post('/', ctrl.submitRequest);

// Edit own pending request (or any if user has requests:edit)
router.patch('/:requestId', ctrl.editRequest);

// Cancel own pending request (or any if user has requests:edit)
router.post('/:requestId/cancel', ctrl.cancelRequest);

// ═════════════════════════════════════════════════════════════════════════
// ADMIN / HR — approve, reject, list all, view any
// ═════════════════════════════════════════════════════════════════════════

// List requests — controller checks scope: 'mine' (self) vs 'all' (needs requests:view)
router.get('/', ctrl.listRequests);

// Approve / reject — only HR/admin
router.post(
  '/:requestId/approve',
  authorize('requests', 'edit'),
  ctrl.approveRequest
);
router.post(
  '/:requestId/reject',
  authorize('requests', 'edit'),
  ctrl.rejectRequest
);

// Comments — anyone who can see the request (controller checks isSubmitter OR requests:view)
router.post('/:requestId/comments', ctrl.addComment);

// View one request — controller checks isSubmitter OR requests:view
router.get('/:requestId', ctrl.getRequest);

export default router;