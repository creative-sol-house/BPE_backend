// routes/accountingRoutes.ts
import { Router } from 'express';
import * as accountingController from '../controller/accouting';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const accountingRouter = Router();

accountingRouter.use(authenticate);

// ═════════════════════════════════════════════════════════════════════════
// SPECIFIC ROUTES FIRST (must come before generic /:xxxId patterns)
// ═════════════════════════════════════════════════════════════════════════

// ─── CONFIG ─────────────────────────────────────────────────────────────
accountingRouter.get(
  '/config',
  authorize('accounting', 'view'),
  accountingController.getConfig
);

accountingRouter.patch(
  '/config',
  authorize('accounting', 'edit'),
  accountingController.updateConfig
);

// ─── DASHBOARD SUMMARY ──────────────────────────────────────────────────
accountingRouter.get(
  '/reports/dashboard',
  authorize('accounting', 'view'),
  accountingController.dashboardSummary
);

// ─── TRIAL BALANCE ──────────────────────────────────────────────────────
accountingRouter.get(
  '/reports/trial-balance',
  authorize('accounting', 'view'),
  accountingController.trialBalanceReport
);

// ─── AGING REPORTS ──────────────────────────────────────────────────────
accountingRouter.get(
  '/reports/receivables-aging',
  authorize('accounting', 'view'),
  accountingController.receivablesAgingReport
);

accountingRouter.get(
  '/reports/payables-aging',
  authorize('accounting', 'view'),
  accountingController.payablesAgingReport
);

// ─── ACCOUNT LEDGER REPORT ──────────────────────────────────────────────
accountingRouter.get(
  '/reports/account-ledger/:accountId',
  authorize('accounting', 'view'),
  accountingController.accountLedgerReport
);

// ─── ACCOUNTS: TREE + SEED (specific before generic) ────────────────────
accountingRouter.get(
  '/accounts/tree',
  authorize('accounting', 'view'),
  accountingController.getAccountTree
);

accountingRouter.post(
  '/accounts/seed',
  authorize('accounting', 'add'),
  accountingController.seedAccounts
);

// ─── FISCAL PERIODS: GENERATE (specific before generic) ─────────────────
accountingRouter.post(
  '/fiscal-periods/generate',
  authorize('accounting', 'add'),
  accountingController.generateFiscalYear
);

// ─── INVOICES: FROM PROPOSAL (specific before generic) ──────────────────
accountingRouter.post(
  '/invoices/from-proposal/:proposalId',
  authorize('accounting', 'add'),
  accountingController.createInvoiceFromProposal
);

// ─── LEDGER: MANUAL ENTRY (specific before generic) ─────────────────────
accountingRouter.post(
  '/ledger/manual',
  authorize('accounting', 'add'),
  accountingController.createManualLedgerEntry
);

// ─── LEDGER: CLIENT & PROVIDER ──────────────────────────────────────────
accountingRouter.get(
  '/ledger/client/:clientId',
  authorize('accounting', 'view'),
  accountingController.getClientLedger
);

accountingRouter.get(
  '/ledger/provider/:providerId',
  authorize('accounting', 'view'),
  accountingController.getProviderLedger
);

// ─── BOOKS (CB / BB) ────────────────────────────────────────────────────
accountingRouter.get(
  '/books/cash',
  authorize('accounting', 'view'),
  accountingController.getCashBook
);

accountingRouter.get(
  '/bank-accounts/:bankAccountId',
  authorize('accounting', 'view'),
  accountingController.getBankAccount
);

accountingRouter.get(
  '/books/bank/:bankAccountId',
  authorize('accounting', 'view'),
  accountingController.getBankBook
);

// ─── POSTING RULES: BATCH (specific before generic) ─────────────────────
accountingRouter.post(
  '/posting-rules/batch',
  authorize('accounting', 'edit'),
  accountingController.registerRuleBatch
);

// ═════════════════════════════════════════════════════════════════════════
// CHART OF ACCOUNTS (COA)
// ═════════════════════════════════════════════════════════════════════════

accountingRouter.get(
  '/accounts',
  authorize('accounting', 'view'),
  accountingController.listAccounts
);

accountingRouter.post(
  '/accounts',
  authorize('accounting', 'add'),
  accountingController.createAccount
);

accountingRouter.get(
  '/accounts/:accountId',
  authorize('accounting', 'view'),
  accountingController.getAccount
);

accountingRouter.patch(
  '/accounts/:accountId',
  authorize('accounting', 'edit'),
  accountingController.updateAccount
);

accountingRouter.delete(
  '/accounts/:accountId',
  authorize('accounting', 'delete'),
  accountingController.deleteAccount
);

accountingRouter.post(
  '/accounts/:accountId/restore',
  authorize('accounting', 'edit'),
  accountingController.restoreAccount
);

// ═════════════════════════════════════════════════════════════════════════
// FISCAL PERIODS
// ═════════════════════════════════════════════════════════════════════════

accountingRouter.get(
  '/fiscal-periods',
  authorize('accounting', 'view'),
  accountingController.listFiscalPeriods
);

accountingRouter.post(
  '/fiscal-periods/:periodId/close',
  authorize('accounting', 'edit'),
  accountingController.closeFiscalPeriod
);

accountingRouter.post(
  '/fiscal-periods/:periodId/lock',
  authorize('accounting', 'edit'),
  accountingController.lockFiscalPeriod
);

accountingRouter.post(
  '/fiscal-periods/:periodId/reopen',
  authorize('accounting', 'edit'),
  accountingController.reopenFiscalPeriod
);

// ═════════════════════════════════════════════════════════════════════════
// JOURNAL ENTRIES
// ═════════════════════════════════════════════════════════════════════════

accountingRouter.get(
  '/journal-entries',
  authorize('accounting', 'view'),
  accountingController.listJournalEntries
);

accountingRouter.post(
  '/journal-entries',
  authorize('accounting', 'add'),
  accountingController.createJournalEntry
);

accountingRouter.get(
  '/journal-entries/:entryId',
  authorize('accounting', 'view'),
  accountingController.getJournalEntry
);

accountingRouter.post(
  '/journal-entries/:entryId/post',
  authorize('accounting', 'edit'),
  accountingController.postJournalEntryHandler
);

accountingRouter.post(
  '/journal-entries/:entryId/reverse',
  authorize('accounting', 'edit'),
  accountingController.reverseJournalEntryHandler
);

accountingRouter.delete(
  '/journal-entries/:entryId',
  authorize('accounting', 'delete'),
  accountingController.deleteJournalEntry
);

// ═════════════════════════════════════════════════════════════════════════
// INVOICES (AR)
// ═════════════════════════════════════════════════════════════════════════

accountingRouter.get(
  '/invoices',
  authorize('accounting', 'view'),
  accountingController.listInvoices
);

accountingRouter.post(
  '/invoices',
  authorize('accounting', 'add'),
  accountingController.createInvoice
);

accountingRouter.get(
  '/invoices/:invoiceId',
  authorize('accounting', 'view'),
  accountingController.getInvoice
);

accountingRouter.patch(
  '/invoices/:invoiceId',
  authorize('accounting', 'edit'),
  accountingController.updateInvoice
);

accountingRouter.post(
  '/invoices/:invoiceId/send',
  authorize('accounting', 'edit'),
  accountingController.sendInvoice
);

accountingRouter.delete(
  '/invoices/:invoiceId',
  authorize('accounting', 'delete'),
  accountingController.deleteInvoice
);

// ═════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ═════════════════════════════════════════════════════════════════════════

accountingRouter.get(
  '/payments',
  authorize('accounting', 'view'),
  accountingController.listPayments
);

accountingRouter.post(
  '/payments',
  authorize('accounting', 'add'),
  accountingController.createPayment
);

accountingRouter.get(
  '/payments/:paymentId',
  authorize('accounting', 'view'),
  accountingController.getPayment
);

accountingRouter.post(
  '/payments/:paymentId/allocate',
  authorize('accounting', 'edit'),
  accountingController.allocatePayment
);

accountingRouter.delete(
  '/payments/:paymentId',
  authorize('accounting', 'delete'),
  accountingController.deletePayment
);

// ═════════════════════════════════════════════════════════════════════════
// BANK ACCOUNTS
// ═════════════════════════════════════════════════════════════════════════

accountingRouter.get(
  '/bank-accounts',
  authorize('accounting', 'view'),
  accountingController.listBankAccounts
);

accountingRouter.post(
  '/bank-accounts',
  authorize('accounting', 'add'),
  accountingController.createBankAccount
);

accountingRouter.patch(
  '/bank-accounts/:bankAccountId',
  authorize('accounting', 'edit'),
  accountingController.updateBankAccount
);

accountingRouter.delete(
  '/bank-accounts/:bankAccountId',
  authorize('accounting', 'delete'),
  accountingController.deleteBankAccount
);

// ═════════════════════════════════════════════════════════════════════════
// BANK TRANSACTIONS
// ═════════════════════════════════════════════════════════════════════════

accountingRouter.get(
  '/bank-transactions',
  authorize('accounting', 'view'),
  accountingController.listBankTransactions
);

accountingRouter.post(
  '/bank-transactions',
  authorize('accounting', 'add'),
  accountingController.createBankTransaction
);

accountingRouter.get(
  '/bank-transactions/:transactionId',
  authorize('accounting', 'view'),
  accountingController.getBankTransaction
);

accountingRouter.post(
  '/bank-transactions/:transactionId/reconcile',
  authorize('accounting', 'edit'),
  accountingController.reconcileBankTransaction
);

accountingRouter.post(
  '/bank-transactions/:transactionId/unreconcile',
  authorize('accounting', 'edit'),
  accountingController.unreconcileBankTransaction
);

accountingRouter.post(
  '/bank-transactions/:transactionId/void',
  authorize('accounting', 'edit'),
  accountingController.voidBankTransaction
);

// ═════════════════════════════════════════════════════════════════════════
// BANK RECONCILIATIONS
// ═════════════════════════════════════════════════════════════════════════

accountingRouter.post(
  '/bank-reconciliations',
  authorize('accounting', 'add'),
  accountingController.createBankReconciliation
);

accountingRouter.post(
  '/bank-reconciliations/:reconciliationId/complete',
  authorize('accounting', 'edit'),
  accountingController.completeBankReconciliation
);

// ═════════════════════════════════════════════════════════════════════════
// POSTING RULES
// ═════════════════════════════════════════════════════════════════════════

accountingRouter.get(
  '/posting-rules',
  authorize('accounting', 'view'),
  accountingController.listPostingRules
);

accountingRouter.post(
  '/posting-rules',
  authorize('accounting', 'edit'),
  accountingController.registerRule
);

// ═════════════════════════════════════════════════════════════════════════
// INTEGRATIONS
// ═════════════════════════════════════════════════════════════════════════

// ProviderExpense → GL posting
accountingRouter.post(
  '/integrations/provider-expense/:expenseId/post',
  authorize('accounting', 'add'),
  accountingController.postProviderExpenseToGL
);

accountingRouter.get(
  '/invoices/:invoiceId/pdf',
  authorize('accounting', 'view'),
  accountingController.downloadInvoicePdf
);

export default accountingRouter;