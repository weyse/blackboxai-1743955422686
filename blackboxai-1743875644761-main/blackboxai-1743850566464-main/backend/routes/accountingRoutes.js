const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const accountingController = require('../controllers/accountingController');

// Middleware to check if user has accounting access
const hasAccountingAccess = (req, res, next) => {
    if (['admin', 'manager'].includes(req.user.role)) {
        next();
    } else {
        res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }
};

// Chart of Accounts Routes
router.get('/chart-of-accounts', 
    auth, 
    (req, res) => accountingController.getAllAccounts(req, res)
);

router.get('/chart-of-accounts/:id',
    auth,
    param('id').isInt().withMessage('Invalid account ID'),
    validate,
    (req, res) => accountingController.getAccountById(req, res)
);

router.post('/chart-of-accounts',
    auth,
    hasAccountingAccess,
    [
        body('account_code').notEmpty().withMessage('Account code is required')
            .matches(/^[0-9]{4,}$/).withMessage('Account code must be at least 4 digits'),
        body('account_name').notEmpty().withMessage('Account name is required')
            .isLength({ min: 3 }).withMessage('Account name must be at least 3 characters'),
        body('account_type').isIn(['asset', 'liability', 'equity', 'revenue', 'expense'])
            .withMessage('Invalid account type'),
        body('parent_id').optional().isInt().withMessage('Invalid parent account ID')
    ],
    validate,
    (req, res) => accountingController.createAccount(req, res)
);

router.put('/chart-of-accounts/:id',
    auth,
    hasAccountingAccess,
    [
        param('id').isInt().withMessage('Invalid account ID'),
        body('account_name').optional().isLength({ min: 3 })
            .withMessage('Account name must be at least 3 characters'),
        body('account_type').optional().isIn(['asset', 'liability', 'equity', 'revenue', 'expense'])
            .withMessage('Invalid account type'),
        body('description').optional().isString(),
        body('parent_id').optional().isInt().withMessage('Invalid parent account ID')
    ],
    validate,
    (req, res) => accountingController.updateAccount(req, res)
);

// Journal Entry Routes
router.get('/journal-entries',
    auth,
    [
        query('start_date').optional().isDate().withMessage('Invalid start date'),
        query('end_date').optional().isDate().withMessage('Invalid end date'),
        query('status').optional().isIn(['draft', 'posted', 'void']).withMessage('Invalid status')
    ],
    validate,
    (req, res) => accountingController.getJournalEntries(req, res)
);

router.get('/journal-entries/:id',
    auth,
    param('id').isInt().withMessage('Invalid journal entry ID'),
    validate,
    (req, res) => accountingController.getJournalEntryById(req, res)
);

router.post('/journal-entries',
    auth,
    hasAccountingAccess,
    [
        body('entry_date').isDate().withMessage('Valid entry date is required'),
        body('description').notEmpty().withMessage('Description is required'),
        body('details').isArray({ min: 1 }).withMessage('At least one journal detail is required'),
        body('details.*.account_id').isInt().withMessage('Valid account ID is required for each detail'),
        body('details.*.debit').isFloat({ min: 0 }).withMessage('Valid debit amount is required'),
        body('details.*.credit').isFloat({ min: 0 }).withMessage('Valid credit amount is required')
    ],
    validate,
    (req, res) => accountingController.createJournalEntry(req, res)
);

router.put('/journal-entries/:id',
    auth,
    hasAccountingAccess,
    [
        param('id').isInt().withMessage('Invalid journal entry ID'),
        body('entry_date').optional().isDate().withMessage('Invalid entry date'),
        body('description').optional().notEmpty().withMessage('Description cannot be empty'),
        body('status').optional().isIn(['draft', 'posted', 'void']).withMessage('Invalid status')
    ],
    validate,
    (req, res) => accountingController.updateJournalEntry(req, res)
);

// Budget Routes
router.get('/budgets',
    auth,
    [
        query('fiscal_year').optional().isInt().withMessage('Invalid fiscal year'),
        query('account_id').optional().isInt().withMessage('Invalid account ID')
    ],
    validate,
    (req, res) => accountingController.getBudgets(req, res)
);

router.post('/budgets',
    auth,
    hasAccountingAccess,
    [
        body('fiscal_year').isInt().withMessage('Fiscal year is required'),
        body('account_id').isInt().withMessage('Account ID is required'),
        body('amount').isFloat({ min: 0 }).withMessage('Valid amount is required'),
        body('description').optional().isString()
    ],
    validate,
    (req, res) => accountingController.createBudget(req, res)
);

// Fixed Assets Routes
router.get('/fixed-assets',
    auth,
    (req, res) => accountingController.getFixedAssets(req, res)
);

router.post('/fixed-assets',
    auth,
    hasAccountingAccess,
    [
        body('asset_code').notEmpty().withMessage('Asset code is required'),
        body('asset_name').notEmpty().withMessage('Asset name is required'),
        body('purchase_date').isDate().withMessage('Valid purchase date is required'),
        body('purchase_cost').isFloat({ min: 0 }).withMessage('Valid purchase cost is required'),
        body('useful_life_years').isInt({ min: 1 }).withMessage('Valid useful life in years is required'),
        body('depreciation_method').isIn(['straight_line', 'declining_balance'])
            .withMessage('Invalid depreciation method')
    ],
    validate,
    (req, res) => accountingController.createFixedAsset(req, res)
);

// Asset Depreciation Routes
router.get('/asset-depreciation/:asset_id',
    auth,
    param('asset_id').isInt().withMessage('Invalid asset ID'),
    validate,
    (req, res) => accountingController.getAssetDepreciation(req, res)
);

router.post('/asset-depreciation/calculate',
    auth,
    hasAccountingAccess,
    [
        body('asset_id').isInt().withMessage('Asset ID is required'),
        body('calculation_date').isDate().withMessage('Valid calculation date is required')
    ],
    validate,
    (req, res) => accountingController.calculateDepreciation(req, res)
);

// Reports
router.get('/reports/balance-sheet',
    auth,
    [
        query('as_of_date').isDate().withMessage('Valid as of date is required')
    ],
    validate,
    (req, res) => accountingController.generateBalanceSheet(req, res)
);

router.get('/reports/income-statement',
    auth,
    [
        query('start_date').isDate().withMessage('Valid start date is required'),
        query('end_date').isDate().withMessage('Valid end date is required')
    ],
    validate,
    (req, res) => accountingController.generateIncomeStatement(req, res)
);

router.get('/reports/trial-balance',
    auth,
    [
        query('as_of_date').isDate().withMessage('Valid as of date is required')
    ],
    validate,
    (req, res) => accountingController.generateTrialBalance(req, res)
);

module.exports = router;