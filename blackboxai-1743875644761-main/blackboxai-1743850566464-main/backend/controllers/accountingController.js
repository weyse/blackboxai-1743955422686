const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

/**
 * Chart of Accounts Controllers
 */
const getAllAccounts = async (req, res) => {
    try {
        const accounts = await sequelize.query(
            `SELECT 
                a.*,
                p.account_name as parent_account_name,
                (SELECT COUNT(*) FROM chart_of_accounts WHERE parent_id = a.id) as has_children
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_id = p.id
            ORDER BY a.account_code`,
            { type: QueryTypes.SELECT }
        );

        res.json({
            success: true,
            data: accounts
        });
    } catch (error) {
        console.error('Error in getAllAccounts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve chart of accounts'
        });
    }
};

const getAccountById = async (req, res) => {
    try {
        const [account] = await sequelize.query(
            `SELECT 
                a.*,
                p.account_name as parent_account_name
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_id = p.id
            WHERE a.id = ?`,
            {
                replacements: [req.params.id],
                type: QueryTypes.SELECT
            }
        );

        if (!account) {
            return res.status(404).json({
                success: false,
                message: 'Account not found'
            });
        }

        res.json({
            success: true,
            data: account
        });
    } catch (error) {
        console.error('Error in getAccountById:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve account'
        });
    }
};

const createAccount = async (req, res) => {
    const t = await sequelize.transaction();

    try {
        // Check if account code already exists
        const [existingAccount] = await sequelize.query(
            'SELECT id FROM chart_of_accounts WHERE account_code = ?',
            {
                replacements: [req.body.account_code],
                type: QueryTypes.SELECT,
                transaction: t
            }
        );

        if (existingAccount) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Account code already exists'
            });
        }

        // Create new account
        const [accountId] = await sequelize.query(
            `INSERT INTO chart_of_accounts 
            (account_code, account_name, account_type, description, parent_id) 
            VALUES (?, ?, ?, ?, ?)`,
            {
                replacements: [
                    req.body.account_code,
                    req.body.account_name,
                    req.body.account_type,
                    req.body.description || null,
                    req.body.parent_id || null
                ],
                type: QueryTypes.INSERT,
                transaction: t
            }
        );

        await t.commit();

        res.status(201).json({
            success: true,
            message: 'Account created successfully',
            data: { id: accountId }
        });
    } catch (error) {
        await t.rollback();
        console.error('Error in createAccount:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create account'
        });
    }
};

const updateAccount = async (req, res) => {
    const t = await sequelize.transaction();

    try {
        const [account] = await sequelize.query(
            'SELECT id FROM chart_of_accounts WHERE id = ?',
            {
                replacements: [req.params.id],
                type: QueryTypes.SELECT,
                transaction: t
            }
        );

        if (!account) {
            await t.rollback();
            return res.status(404).json({
                success: false,
                message: 'Account not found'
            });
        }

        await sequelize.query(
            `UPDATE chart_of_accounts 
            SET 
                account_name = COALESCE(?, account_name),
                account_type = COALESCE(?, account_type),
                description = COALESCE(?, description),
                parent_id = COALESCE(?, parent_id)
            WHERE id = ?`,
            {
                replacements: [
                    req.body.account_name || null,
                    req.body.account_type || null,
                    req.body.description || null,
                    req.body.parent_id || null,
                    req.params.id
                ],
                type: QueryTypes.UPDATE,
                transaction: t
            }
        );

        await t.commit();

        res.json({
            success: true,
            message: 'Account updated successfully'
        });
    } catch (error) {
        await t.rollback();
        console.error('Error in updateAccount:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update account'
        });
    }
};

/**
 * Journal Entry Controllers
 */
const getJournalEntries = async (req, res) => {
    try {
        let query = `
            SELECT 
                j.*,
                u.username as created_by_user
            FROM journal_entries j
            LEFT JOIN users u ON j.created_by = u.id
            WHERE 1=1
        `;
        const replacements = [];

        if (req.query.start_date) {
            query += ' AND j.entry_date >= ?';
            replacements.push(req.query.start_date);
        }
        if (req.query.end_date) {
            query += ' AND j.entry_date <= ?';
            replacements.push(req.query.end_date);
        }
        if (req.query.status) {
            query += ' AND j.status = ?';
            replacements.push(req.query.status);
        }

        query += ' ORDER BY j.entry_date DESC, j.id DESC';

        const entries = await sequelize.query(query, {
            replacements,
            type: QueryTypes.SELECT
        });

        // Get details for each entry
        for (let entry of entries) {
            entry.details = await sequelize.query(
                `SELECT 
                    d.*,
                    a.account_code,
                    a.account_name
                FROM journal_details d
                JOIN chart_of_accounts a ON d.account_id = a.id
                WHERE d.journal_id = ?`,
                {
                    replacements: [entry.id],
                    type: QueryTypes.SELECT
                }
            );
        }

        res.json({
            success: true,
            data: entries
        });
    } catch (error) {
        console.error('Error in getJournalEntries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve journal entries'
        });
    }
};

const createJournalEntry = async (req, res) => {
    const t = await sequelize.transaction();

    try {
        // Validate debits and credits balance
        const totalDebit = req.body.details.reduce((sum, detail) => sum + parseFloat(detail.debit), 0);
        const totalCredit = req.body.details.reduce((sum, detail) => sum + parseFloat(detail.credit), 0);

        if (Math.abs(totalDebit - totalCredit) > 0.01) { // Allow for small floating point differences
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Debits and credits must be equal'
            });
        }

        // Create journal entry
        const [journalId] = await sequelize.query(
            `INSERT INTO journal_entries 
            (entry_date, reference_no, description, created_by) 
            VALUES (?, ?, ?, ?)`,
            {
                replacements: [
                    req.body.entry_date,
                    req.body.reference_no,
                    req.body.description,
                    req.user.id
                ],
                type: QueryTypes.INSERT,
                transaction: t
            }
        );

        // Create journal details
        for (const detail of req.body.details) {
            await sequelize.query(
                `INSERT INTO journal_details 
                (journal_id, account_id, debit, credit, description) 
                VALUES (?, ?, ?, ?, ?)`,
                {
                    replacements: [
                        journalId,
                        detail.account_id,
                        detail.debit,
                        detail.credit,
                        detail.description || null
                    ],
                    type: QueryTypes.INSERT,
                    transaction: t
                }
            );
        }

        await t.commit();

        res.status(201).json({
            success: true,
            message: 'Journal entry created successfully',
            data: { id: journalId }
        });
    } catch (error) {
        await t.rollback();
        console.error('Error in createJournalEntry:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create journal entry'
        });
    }
};

/**
 * Report Generation Controllers
 */
const generateBalanceSheet = async (req, res) => {
    try {
        const asOfDate = req.query.as_of_date;

        // Get all accounts with their balances
        const accounts = await sequelize.query(
            `WITH RECURSIVE AccountHierarchy AS (
                SELECT 
                    id, 
                    account_code,
                    account_name,
                    account_type,
                    parent_id,
                    0 as level
                FROM chart_of_accounts
                WHERE parent_id IS NULL
                
                UNION ALL
                
                SELECT 
                    c.id,
                    c.account_code,
                    c.account_name,
                    c.account_type,
                    c.parent_id,
                    ah.level + 1
                FROM chart_of_accounts c
                INNER JOIN AccountHierarchy ah ON c.parent_id = ah.id
            )
            SELECT 
                ah.*,
                COALESCE(
                    (SELECT SUM(debit) - SUM(credit)
                    FROM journal_details jd
                    JOIN journal_entries je ON jd.journal_id = je.id
                    WHERE jd.account_id = ah.id
                    AND je.entry_date <= ?
                    AND je.status = 'posted'), 0
                ) as balance
            FROM AccountHierarchy ah
            WHERE ah.account_type IN ('asset', 'liability', 'equity')
            ORDER BY ah.account_code`,
            {
                replacements: [asOfDate],
                type: QueryTypes.SELECT
            }
        );

        // Organize data for balance sheet
        const balanceSheet = {
            asOfDate,
            assets: accounts.filter(a => a.account_type === 'asset'),
            liabilities: accounts.filter(a => a.account_type === 'liability'),
            equity: accounts.filter(a => a.account_type === 'equity'),
            totalAssets: accounts
                .filter(a => a.account_type === 'asset')
                .reduce((sum, account) => sum + parseFloat(account.balance), 0),
            totalLiabilities: accounts
                .filter(a => a.account_type === 'liability')
                .reduce((sum, account) => sum + parseFloat(account.balance), 0),
            totalEquity: accounts
                .filter(a => a.account_type === 'equity')
                .reduce((sum, account) => sum + parseFloat(account.balance), 0)
        };

        res.json({
            success: true,
            data: balanceSheet
        });
    } catch (error) {
        console.error('Error in generateBalanceSheet:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate balance sheet'
        });
    }
};

const generateIncomeStatement = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        // Get revenue and expense accounts with their balances
        const accounts = await sequelize.query(
            `WITH RECURSIVE AccountHierarchy AS (
                SELECT 
                    id, 
                    account_code,
                    account_name,
                    account_type,
                    parent_id,
                    0 as level
                FROM chart_of_accounts
                WHERE parent_id IS NULL
                
                UNION ALL
                
                SELECT 
                    c.id,
                    c.account_code,
                    c.account_name,
                    c.account_type,
                    c.parent_id,
                    ah.level + 1
                FROM chart_of_accounts c
                INNER JOIN AccountHierarchy ah ON c.parent_id = ah.id
            )
            SELECT 
                ah.*,
                COALESCE(
                    (SELECT SUM(CASE 
                        WHEN ah.account_type = 'revenue' THEN credit - debit
                        WHEN ah.account_type = 'expense' THEN debit - credit
                        END)
                    FROM journal_details jd
                    JOIN journal_entries je ON jd.journal_id = je.id
                    WHERE jd.account_id = ah.id
                    AND je.entry_date BETWEEN ? AND ?
                    AND je.status = 'posted'), 0
                ) as balance
            FROM AccountHierarchy ah
            WHERE ah.account_type IN ('revenue', 'expense')
            ORDER BY ah.account_code`,
            {
                replacements: [start_date, end_date],
                type: QueryTypes.SELECT
            }
        );

        // Organize data for income statement
        const incomeStatement = {
            period: {
                startDate: start_date,
                endDate: end_date
            },
            revenue: accounts.filter(a => a.account_type === 'revenue'),
            expenses: accounts.filter(a => a.account_type === 'expense'),
            totalRevenue: accounts
                .filter(a => a.account_type === 'revenue')
                .reduce((sum, account) => sum + parseFloat(account.balance), 0),
            totalExpenses: accounts
                .filter(a => a.account_type === 'expense')
                .reduce((sum, account) => sum + parseFloat(account.balance), 0)
        };

        // Calculate net income/loss
        incomeStatement.netIncome = incomeStatement.totalRevenue - incomeStatement.totalExpenses;

        res.json({
            success: true,
            data: incomeStatement
        });
    } catch (error) {
        console.error('Error in generateIncomeStatement:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate income statement'
        });
    }
};

const generateTrialBalance = async (req, res) => {
    try {
        const { as_of_date } = req.query;

        // Get all accounts with their balances
        const accounts = await sequelize.query(
            `SELECT 
                a.*,
                COALESCE(
                    (SELECT SUM(debit) FROM journal_details jd
                    JOIN journal_entries je ON jd.journal_id = je.id
                    WHERE jd.account_id = a.id
                    AND je.entry_date <= ?
                    AND je.status = 'posted'), 0
                ) as total_debit,
                COALESCE(
                    (SELECT SUM(credit) FROM journal_details jd
                    JOIN journal_entries je ON jd.journal_id = je.id
                    WHERE jd.account_id = a.id
                    AND je.entry_date <= ?
                    AND je.status = 'posted'), 0
                ) as total_credit
            FROM chart_of_accounts a
            ORDER BY a.account_code`,
            {
                replacements: [as_of_date, as_of_date],
                type: QueryTypes.SELECT
            }
        );

        // Calculate running balances
        const trialBalance = {
            asOfDate: as_of_date,
            accounts: accounts.map(account => ({
                ...account,
                balance: parseFloat(account.total_debit) - parseFloat(account.total_credit)
            })),
            totalDebit: accounts.reduce((sum, account) => sum + parseFloat(account.total_debit), 0),
            totalCredit: accounts.reduce((sum, account) => sum + parseFloat(account.total_credit), 0)
        };

        res.json({
            success: true,
            data: trialBalance
        });
    } catch (error) {
        console.error('Error in generateTrialBalance:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate trial balance'
        });
    }
};

const getFixedAssets = async (req, res) => {
    try {
        const assets = await sequelize.query(
            `SELECT 
                fa.*,
                COALESCE(
                    (SELECT accumulated_depreciation 
                     FROM asset_depreciation 
                     WHERE asset_id = fa.id 
                     ORDER BY depreciation_date DESC 
                     LIMIT 1), 0
                ) as accumulated_depreciation,
                COALESCE(
                    (SELECT book_value 
                     FROM asset_depreciation 
                     WHERE asset_id = fa.id 
                     ORDER BY depreciation_date DESC 
                     LIMIT 1), fa.purchase_cost
                ) as current_book_value
            FROM fixed_assets fa
            ORDER BY fa.asset_code`,
            { type: QueryTypes.SELECT }
        );

        res.json({
            success: true,
            data: assets
        });
    } catch (error) {
        console.error('Error in getFixedAssets:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve fixed assets'
        });
    }
};

const createFixedAsset = async (req, res) => {
    const t = await sequelize.transaction();

    try {
        // Check if asset code already exists
        const [existingAsset] = await sequelize.query(
            'SELECT id FROM fixed_assets WHERE asset_code = ?',
            {
                replacements: [req.body.asset_code],
                type: QueryTypes.SELECT,
                transaction: t
            }
        );

        if (existingAsset) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Asset code already exists'
            });
        }

        // Create new fixed asset
        const [assetId] = await sequelize.query(
            `INSERT INTO fixed_assets 
            (asset_code, asset_name, purchase_date, purchase_cost, useful_life_years, 
             salvage_value, depreciation_method, account_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            {
                replacements: [
                    req.body.asset_code,
                    req.body.asset_name,
                    req.body.purchase_date,
                    req.body.purchase_cost,
                    req.body.useful_life_years,
                    req.body.salvage_value || 0,
                    req.body.depreciation_method,
                    req.body.account_id
                ],
                type: QueryTypes.INSERT,
                transaction: t
            }
        );

        await t.commit();

        res.status(201).json({
            success: true,
            message: 'Fixed asset created successfully',
            data: { id: assetId }
        });
    } catch (error) {
        await t.rollback();
        console.error('Error in createFixedAsset:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create fixed asset'
        });
    }
};

const calculateDepreciation = async (req, res) => {
    const t = await sequelize.transaction();

    try {
        const { asset_id, calculation_date } = req.body;

        // Get asset details
        const [asset] = await sequelize.query(
            'SELECT * FROM fixed_assets WHERE id = ?',
            {
                replacements: [asset_id],
                type: QueryTypes.SELECT,
                transaction: t
            }
        );

        if (!asset) {
            await t.rollback();
            return res.status(404).json({
                success: false,
                message: 'Asset not found'
            });
        }

        // Get latest depreciation entry
        const [lastDepreciation] = await sequelize.query(
            `SELECT * FROM asset_depreciation 
            WHERE asset_id = ? 
            ORDER BY depreciation_date DESC 
            LIMIT 1`,
            {
                replacements: [asset_id],
                type: QueryTypes.SELECT,
                transaction: t
            }
        );

        let depreciationAmount = 0;
        let accumulatedDepreciation = lastDepreciation ? lastDepreciation.accumulated_depreciation : 0;
        let bookValue = lastDepreciation ? lastDepreciation.book_value : asset.purchase_cost;

        // Calculate depreciation based on method
        if (asset.depreciation_method === 'straight_line') {
            const annualDepreciation = (asset.purchase_cost - (asset.salvage_value || 0)) / asset.useful_life_years;
            depreciationAmount = annualDepreciation / 12; // Monthly depreciation
        } else if (asset.depreciation_method === 'declining_balance') {
            const rate = 2 / asset.useful_life_years; // Double declining rate
            depreciationAmount = (bookValue * rate) / 12;
        }

        // Update accumulated values
        accumulatedDepreciation += depreciationAmount;
        bookValue = asset.purchase_cost - accumulatedDepreciation;

        // Ensure we don't depreciate below salvage value
        if (bookValue < (asset.salvage_value || 0)) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Asset cannot be depreciated below salvage value'
            });
        }

        // Record depreciation
        await sequelize.query(
            `INSERT INTO asset_depreciation 
            (asset_id, depreciation_date, amount, accumulated_depreciation, book_value) 
            VALUES (?, ?, ?, ?, ?)`,
            {
                replacements: [
                    asset_id,
                    calculation_date,
                    depreciationAmount,
                    accumulatedDepreciation,
                    bookValue
                ],
                type: QueryTypes.INSERT,
                transaction: t
            }
        );

        await t.commit();

        res.json({
            success: true,
            data: {
                depreciationAmount,
                accumulatedDepreciation,
                bookValue
            }
        });
    } catch (error) {
        await t.rollback();
        console.error('Error in calculateDepreciation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to calculate depreciation'
        });
    }
};

const getAssetDepreciation = async (req, res) => {
    try {
        const assetId = req.params.asset_id;

        // Get asset details with depreciation history
        const [asset] = await sequelize.query(
            `SELECT 
                fa.*,
                (SELECT COUNT(*) FROM asset_depreciation WHERE asset_id = fa.id) as depreciation_entries
            FROM fixed_assets fa
            WHERE fa.id = ?`,
            {
                replacements: [assetId],
                type: QueryTypes.SELECT
            }
        );

        if (!asset) {
            return res.status(404).json({
                success: false,
                message: 'Asset not found'
            });
        }

        // Get depreciation history
        const depreciationHistory = await sequelize.query(
            `SELECT * FROM asset_depreciation 
            WHERE asset_id = ? 
            ORDER BY depreciation_date`,
            {
                replacements: [assetId],
                type: QueryTypes.SELECT
            }
        );

        res.json({
            success: true,
            data: {
                asset,
                depreciationHistory
            }
        });
    } catch (error) {
        console.error('Error in getAssetDepreciation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve asset depreciation'
        });
    }
};

const getBudgets = async (req, res) => {
    try {
        let query = `
            SELECT 
                b.*,
                a.account_code,
                a.account_name,
                a.account_type,
                COALESCE(
                    (SELECT SUM(CASE 
                        WHEN a.account_type = 'revenue' THEN credit - debit
                        WHEN a.account_type = 'expense' THEN debit - credit
                        END)
                    FROM journal_details jd
                    JOIN journal_entries je ON jd.journal_id = je.id
                    WHERE jd.account_id = b.account_id
                    AND YEAR(je.entry_date) = b.fiscal_year
                    AND je.status = 'posted'), 0
                ) as actual_amount
            FROM budgets b
            JOIN chart_of_accounts a ON b.account_id = a.id
            WHERE 1=1
        `;
        const replacements = [];

        if (req.query.fiscal_year) {
            query += ' AND b.fiscal_year = ?';
            replacements.push(req.query.fiscal_year);
        }
        if (req.query.account_id) {
            query += ' AND b.account_id = ?';
            replacements.push(req.query.account_id);
        }

        query += ' ORDER BY a.account_code';

        const budgets = await sequelize.query(query, {
            replacements,
            type: QueryTypes.SELECT
        });

        // Calculate variance
        const budgetsWithVariance = budgets.map(budget => ({
            ...budget,
            variance: parseFloat(budget.actual_amount) - parseFloat(budget.amount),
            variance_percentage: ((parseFloat(budget.actual_amount) - parseFloat(budget.amount)) / parseFloat(budget.amount) * 100).toFixed(2)
        }));

        res.json({
            success: true,
            data: budgetsWithVariance
        });
    } catch (error) {
        console.error('Error in getBudgets:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve budgets'
        });
    }
};

const createBudget = async (req, res) => {
    const t = await sequelize.transaction();

    try {
        // Check if budget already exists for this account and fiscal year
        const [existingBudget] = await sequelize.query(
            'SELECT id FROM budgets WHERE account_id = ? AND fiscal_year = ?',
            {
                replacements: [req.body.account_id, req.body.fiscal_year],
                type: QueryTypes.SELECT,
                transaction: t
            }
        );

        if (existingBudget) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Budget already exists for this account and fiscal year'
            });
        }

        // Create new budget
        const [budgetId] = await sequelize.query(
            `INSERT INTO budgets 
            (account_id, fiscal_year, amount, description) 
            VALUES (?, ?, ?, ?)`,
            {
                replacements: [
                    req.body.account_id,
                    req.body.fiscal_year,
                    req.body.amount,
                    req.body.description || null
                ],
                type: QueryTypes.INSERT,
                transaction: t
            }
        );

        await t.commit();

        res.status(201).json({
            success: true,
            message: 'Budget created successfully',
            data: { id: budgetId }
        });
    } catch (error) {
        await t.rollback();
        console.error('Error in createBudget:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create budget'
        });
    }
};

const getBudgetAnalysis = async (req, res) => {
    try {
        const { fiscal_year } = req.query;

        // Get budget vs actual data grouped by account type
        const analysis = await sequelize.query(
            `SELECT 
                a.account_type,
                SUM(b.amount) as budgeted_amount,
                COALESCE(
                    SUM(
                        (SELECT SUM(CASE 
                            WHEN a.account_type = 'revenue' THEN credit - debit
                            WHEN a.account_type = 'expense' THEN debit - credit
                            END)
                        FROM journal_details jd
                        JOIN journal_entries je ON jd.journal_id = je.id
                        WHERE jd.account_id = b.account_id
                        AND YEAR(je.entry_date) = b.fiscal_year
                        AND je.status = 'posted')
                    ), 0
                ) as actual_amount
            FROM budgets b
            JOIN chart_of_accounts a ON b.account_id = a.id
            WHERE b.fiscal_year = ?
            GROUP BY a.account_type`,
            {
                replacements: [fiscal_year],
                type: QueryTypes.SELECT
            }
        );

        // Calculate variances and percentages
        const analysisWithVariance = analysis.map(item => ({
            ...item,
            variance: parseFloat(item.actual_amount) - parseFloat(item.budgeted_amount),
            variance_percentage: ((parseFloat(item.actual_amount) - parseFloat(item.budgeted_amount)) / parseFloat(item.budgeted_amount) * 100).toFixed(2)
        }));

        res.json({
            success: true,
            data: {
                fiscal_year,
                analysis: analysisWithVariance
            }
        });
    } catch (error) {
        console.error('Error in getBudgetAnalysis:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve budget analysis'
        });
    }
};

module.exports = {
    getAllAccounts,
    getAccountById,
    createAccount,
    updateAccount,
    getJournalEntries,
    createJournalEntry,
    generateBalanceSheet,
    generateIncomeStatement,
    generateTrialBalance,
    getFixedAssets,
    createFixedAsset,
    calculateDepreciation,
    getAssetDepreciation,
    getBudgets,
    createBudget,
    getBudgetAnalysis
};