// routes/clientRoutes.ts
import { Router } from 'express';
import * as clientController from '../controller/clientController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const clientRouter = Router();

clientRouter.use(authenticate);

// ═════════════════════════════════════════════════════════════════════════
// SPECIFIC ROUTES FIRST (must come before /:clientId)
// ═════════════════════════════════════════════════════════════════════════

// ─── Dashboard stats ─────────────────────────────────────────────────────
clientRouter.get(
  '/stats',
  authorize('clients', 'view'),
  clientController.getClientStats
);

// ─── Payment-term options (dropdown values for the frontend) ─────────────
clientRouter.get(
  '/payment-terms',
  authorize('clients', 'view'),
  clientController.getPaymentTermOptions
);



// ═════════════════════════════════════════════════════════════════════════
// GENERIC LIST / CREATE
// ═════════════════════════════════════════════════════════════════════════

clientRouter.get(
  '/',
  authorize('clients', 'view'),
  clientController.listClients
);

clientRouter.post(
  '/',
  authorize('clients', 'add'),
  clientController.createClient
);

// ═════════════════════════════════════════════════════════════════════════
// GET / UPDATE ONE (accepts _id or "CLI-XXXXX")
// ═════════════════════════════════════════════════════════════════════════

clientRouter.get(
  '/:clientId',
  authorize('clients', 'view'),
  clientController.getClient
);

clientRouter.patch(
  '/:clientId',
  authorize('clients', 'edit'),
  clientController.updateClient
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: CONTACTS
// ═════════════════════════════════════════════════════════════════════════

clientRouter.post(
  '/:clientId/contacts',
  authorize('clients', 'edit'),
  clientController.addClientContact
);

clientRouter.delete(
  '/:clientId/contacts/:contactId',
  authorize('clients', 'edit'),
  clientController.removeClientContact
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ADDRESSES
// ═════════════════════════════════════════════════════════════════════════

clientRouter.post(
  '/:clientId/addresses',
  authorize('clients', 'edit'),
  clientController.addClientAddress
);

clientRouter.delete(
  '/:clientId/addresses/:addressId',
  authorize('clients', 'edit'),
  clientController.removeClientAddress
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: BANK ACCOUNTS
// ═════════════════════════════════════════════════════════════════════════

clientRouter.post(
  '/:clientId/bank-accounts',
  authorize('clients', 'edit'),
  clientController.addClientBankAccount
);

clientRouter.delete(
  '/:clientId/bank-accounts/:bankId',
  authorize('clients', 'edit'),
  clientController.removeClientBankAccount
);

// ═════════════════════════════════════════════════════════════════════════
// STATUS TRANSITION
// body: { status, statusReason? }
// ═════════════════════════════════════════════════════════════════════════

clientRouter.patch(
  '/:clientId/status',
  authorize('clients', 'edit'),
  clientController.changeClientStatus
);

// ═════════════════════════════════════════════════════════════════════════
// SOFT DELETE / RESTORE
// ═════════════════════════════════════════════════════════════════════════

clientRouter.delete(
  '/:clientId',
  authorize('clients', 'delete'),
  clientController.deleteClient
);

clientRouter.post(
  '/:clientId/restore',
  authorize('clients', 'edit'),
  clientController.restoreClient
);

export default clientRouter;