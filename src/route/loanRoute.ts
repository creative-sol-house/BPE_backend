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

// List & get
router.get('/', authorize('loans', 'view'), ctrl.listLoans);
router.get('/:loanId', authorize('loans', 'view'), ctrl.getLoan);

// Cancel / installment operations
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