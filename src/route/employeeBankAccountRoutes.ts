// routes/employeeBankAccountRoutes.ts
import { Router } from 'express';
import * as controller from '../controller/employeeBankAccountController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router({ mergeParams: true });

router.use(authenticate);

// ═════════════════════════════════════════════════════════════════
// STANDALONE MODULE — FLAT ROUTES
// ═════════════════════════════════════════════════════════════════

// ── List all ────────────────────────────────────────────────────
router.get(
  '/employee-bank-accounts',
  authorize('employees', 'view'),
  controller.listAllBankAccounts
);

// ── Create (employeeId in body) ────────────────────────────────
router.post(
  '/employee-bank-accounts',
  authorize('employees', 'add'),
  controller.createBankAccountFlat
);

// ── Get one ────────────────────────────────────────────────────
router.get(
  '/employee-bank-accounts/:accountId',
  authorize('employees', 'view'),
  controller.getBankAccountFlat
);

// ── Update ─────────────────────────────────────────────────────
router.patch(
  '/employee-bank-accounts/:accountId',
  authorize('employees', 'edit'),
  controller.updateBankAccountFlat
);

// ── Set primary ────────────────────────────────────────────────
router.post(
  '/employee-bank-accounts/:accountId/set-primary',
  authorize('employees', 'edit'),
  controller.setPrimaryBankAccountFlat
);

// ── Verify / Reject ────────────────────────────────────────────
router.post(
  '/employee-bank-accounts/:accountId/verify',
  authorize('employees', 'edit'),
  controller.verifyBankAccountFlat
);

// ── Delete ─────────────────────────────────────────────────────
router.delete(
  '/employee-bank-accounts/:accountId',
  authorize('employees', 'delete'),
  controller.deleteBankAccountFlat
);

// ═════════════════════════════════════════════════════════════════
// PER-EMPLOYEE MODULE — NESTED ROUTES
// ═════════════════════════════════════════════════════════════════

router.get(
  '/employees/:employeeId/bank-accounts',
  authorize('employees', 'view'),
  controller.listEmployeeBankAccounts
);

router.post(
  '/employees/:employeeId/bank-accounts',
  authorize('employees', 'add'),
  controller.createEmployeeBankAccount
);

router.get(
  '/employees/:employeeId/bank-accounts/:accountId',
  authorize('employees', 'view'),
  controller.getEmployeeBankAccount
);

router.patch(
  '/employees/:employeeId/bank-accounts/:accountId',
  authorize('employees', 'edit'),
  controller.updateEmployeeBankAccount
);

router.post(
  '/employees/:employeeId/bank-accounts/:accountId/set-primary',
  authorize('employees', 'edit'),
  controller.setPrimaryEmployeeBankAccount
);

router.post(
  '/employees/:employeeId/bank-accounts/:accountId/verify',
  authorize('employees', 'edit'),
  controller.verifyEmployeeBankAccount
);

router.delete(
  '/employees/:employeeId/bank-accounts/:accountId',
  authorize('employees', 'delete'),
  controller.deleteEmployeeBankAccount
);

export default router;