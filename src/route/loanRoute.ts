// routes/loanRoute.ts
import { Router } from 'express';
import * as ctrl from '../controller/loanController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();
router.use(authenticate);

// Specific routes first
router.get('/stats', ctrl.loanStats);
router.get('/employee/:employeeId/summary', ctrl.getEmployeeLoanSummary);

// List — controller checks scope: mine = self, all = needs loans:view
router.get('/', ctrl.listLoans);

// Get one — controller checks isOwner OR loans:view
router.get('/:loanId', ctrl.getLoan);

// Cancel / installment operations (still admin-only)
router.post('/:loanId/cancel', authorize('loans', 'edit'), ctrl.cancelLoan);
router.post(
  '/:loanId/installments/:seq/pay',
  authorize('loans', 'edit'),
  ctrl.payInstallment
);
router.post(
  '/:loanId/installments/:seq/unpay',
  authorize('loans', 'edit'),
  ctrl.unpayInstallment
);

export default router;