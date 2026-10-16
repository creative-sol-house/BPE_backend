// routes/providerRoutes.ts
import { Router } from 'express';
import * as ctrl from '../controller/providerController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();
router.use(authenticate);

// ── Meta ───────────────────────────────────────────────────────────────
// GET /api/providers/categories  → distinct categories for autocomplete
router.get('/categories', ctrl.listCategories);

// ── Ledger (per month / per week) ─────────────────────────────────────
// GET /api/providers/ledger/monthly?year=&month=&providerId=
router.get(
  '/ledger/monthly',
  authorize('providers', 'view'),
  ctrl.monthlyLedger
);

// GET /api/providers/ledger/weekly?weekOf=YYYY-MM-DD&providerId=
router.get(
  '/ledger/weekly',
  authorize('providers', 'view'),
  ctrl.weeklyLedger
);

// ── Expenses ──────────────────────────────────────────────────────────
router.get('/expenses', authorize('providers', 'view'), ctrl.listExpenses);
router.post('/expenses', authorize('providers', 'add'), ctrl.createExpense);
router.get('/expenses/:expenseId', authorize('providers', 'view'), ctrl.getExpense);
router.patch('/expenses/:expenseId', authorize('providers', 'edit'), ctrl.updateExpense);
router.delete('/expenses/:expenseId', authorize('providers', 'delete'), ctrl.deleteExpense);
router.post(
  '/expenses/:expenseId/mark-paid',
  authorize('providers', 'edit'),
  ctrl.markExpensePaid
);

// ── Providers CRUD ────────────────────────────────────────────────────
router.get('/', authorize('providers', 'view'), ctrl.listProviders);
router.post('/', authorize('providers', 'add'), ctrl.createProvider);
router.get('/:providerId', authorize('providers', 'view'), ctrl.getProvider);
router.patch('/:providerId', authorize('providers', 'edit'), ctrl.updateProvider);
router.delete('/:providerId', authorize('providers', 'delete'), ctrl.deleteProvider);

export default router;