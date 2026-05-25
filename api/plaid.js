// api/plaid.js — Vercel serverless function
// Deploy this on Vercel. Set env vars in Vercel dashboard.
// PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox | development | production)
 
const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');
 
const config = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET':    process.env.PLAID_SECRET,
    },
  },
});
 
const plaid = new PlaidApi(config);
 
// Simple in-memory store (replace with Supabase in production)
const accessTokens = {};
 
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  const { action } = req.query;
 
  try {
    // ── 1. CREATE LINK TOKEN ──
    // Frontend calls this first to open Plaid Link modal
    if (action === 'create_link_token') {
      const response = await plaid.linkTokenCreate({
        user: { client_user_id: req.body?.user_id || 'user-default' },
        client_name: 'Runvy',
        products: [Products.Transactions],
        country_codes: [CountryCode.Us],
        language: 'en',
      });
      return res.json({ link_token: response.data.link_token });
    }
 
    // ── 2. EXCHANGE PUBLIC TOKEN ──
    // After user connects bank in Plaid Link, exchange public_token for access_token
    if (action === 'exchange_token') {
      const { public_token, user_id } = req.body;
      const response = await plaid.itemPublicTokenExchange({ public_token });
      const access_token = response.data.access_token;
      const item_id = response.data.item_id;
 
      // Store access token (use Supabase in production — never expose to frontend)
      accessTokens[user_id || 'user-default'] = { access_token, item_id };
 
      return res.json({ success: true, item_id });
    }
 
    // ── 3. GET ACCOUNTS ──
    if (action === 'accounts') {
      const user_id = req.query.user_id || 'user-default';
      const { access_token } = accessTokens[user_id] || {};
 
      // Sandbox fallback: return mock data if no real token
      if (!access_token) return res.json({ accounts: getMockAccounts() });
 
      const response = await plaid.accountsGet({ access_token });
      return res.json({ accounts: response.data.accounts });
    }
 
    // ── 4. GET TRANSACTIONS ──
    if (action === 'transactions') {
      const user_id = req.query.user_id || 'user-default';
      const { access_token } = accessTokens[user_id] || {};
      const days = parseInt(req.query.days || '90');
      const start = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
      const end   = new Date().toISOString().split('T')[0];
 
      // Sandbox fallback
      if (!access_token) return res.json({ transactions: getMockTransactions(), total: 10 });
 
      const response = await plaid.transactionsGet({
        access_token,
        start_date: start,
        end_date: end,
        options: { count: 100, offset: 0 },
      });
 
      return res.json({
        transactions: response.data.transactions,
        total: response.data.total_transactions,
      });
    }
 
    return res.status(400).json({ error: 'Unknown action' });
 
  } catch (err) {
    console.error('Plaid error:', err.response?.data || err.message);
    return res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
};
 
// ── MOCK DATA (used when no Plaid token yet / demo mode) ──
function getMockAccounts() {
  return [
    { account_id: 'acc_mercury_1', name: 'Mercury Business Checking', official_name: 'Mercury Bank', type: 'depository', subtype: 'checking', balances: { current: 84200, available: 84200, iso_currency_code: 'USD' }, mask: '4821' },
    { account_id: 'acc_brex_1',    name: 'Brex Corporate Card',       official_name: 'Brex',         type: 'credit',    subtype: 'credit card', balances: { current: 3240,  available: 46760, iso_currency_code: 'USD' }, mask: '7721' },
    { account_id: 'acc_svb_1',     name: 'SVB Payroll Account',       official_name: 'SVB',          type: 'depository', subtype: 'checking', balances: { current: 31000, available: 31000, iso_currency_code: 'USD' }, mask: '0392' },
  ];
}
 
function getMockTransactions() {
  const today = new Date();
  const d = (n) => new Date(today - n * 86400000).toISOString().split('T')[0];
  return [
    { transaction_id: 'txn_1',  account_id: 'acc_mercury_1', name: 'AWS',                  merchant_name: 'Amazon Web Services', amount: 1240.00,  date: d(1),  category: ['Technology', 'Cloud Services'],     pending: false },
    { transaction_id: 'txn_2',  account_id: 'acc_mercury_1', name: 'Stripe payout',         merchant_name: 'Stripe',              amount: -4500.00, date: d(1),  category: ['Transfer', 'Credit'],              pending: false },
    { transaction_id: 'txn_3',  account_id: 'acc_mercury_1', name: 'IRS EFTPS',             merchant_name: 'IRS',                 amount: 3850.00,  date: d(2),  category: ['Government', 'Tax Payment'],       pending: false },
    { transaction_id: 'txn_4',  account_id: 'acc_svb_1',     name: 'Gusto Payroll',         merchant_name: 'Gusto',               amount: 11200.00, date: d(5),  category: ['Payroll', 'Employee Benefits'],    pending: false },
    { transaction_id: 'txn_5',  account_id: 'acc_brex_1',    name: 'MacBook Pro',           merchant_name: 'Apple Store',         amount: 2399.00,  date: d(6),  category: ['Shopping', 'Electronics'],         pending: false },
    { transaction_id: 'txn_6',  account_id: 'acc_brex_1',    name: 'Notion',                merchant_name: 'Notion',              amount: 32.00,    date: d(7),  category: ['Software', 'Subscription'],        pending: false },
    { transaction_id: 'txn_7',  account_id: 'acc_brex_1',    name: 'Figma',                 merchant_name: 'Figma',               amount: 75.00,    date: d(7),  category: ['Software', 'Subscription'],        pending: false },
    { transaction_id: 'txn_8',  account_id: 'acc_brex_1',    name: 'Linear',                merchant_name: 'Linear',              amount: 49.00,    date: d(7),  category: ['Software', 'Subscription'],        pending: false },
    { transaction_id: 'txn_9',  account_id: 'acc_mercury_1', name: 'Stripe payout',         merchant_name: 'Stripe',              amount: -8200.00, date: d(8),  category: ['Transfer', 'Credit'],              pending: false },
    { transaction_id: 'txn_10', account_id: 'acc_brex_1',    name: 'Vercel',                merchant_name: 'Vercel',              amount: 40.00,    date: d(9),  category: ['Technology', 'Cloud Services'],    pending: false },
    { transaction_id: 'txn_11', account_id: 'acc_mercury_1', name: 'Stripe payout',         merchant_name: 'Stripe',              amount: -21500.00,date: d(11), category: ['Transfer', 'Credit'],              pending: false },
    { transaction_id: 'txn_12', account_id: 'acc_svb_1',     name: 'Gusto Payroll',         merchant_name: 'Gusto',               amount: 11200.00, date: d(20), category: ['Payroll', 'Employee Benefits'],    pending: false },
    { transaction_id: 'txn_13', account_id: 'acc_brex_1',    name: 'Google Workspace',      merchant_name: 'Google',              amount: 80.00,    date: d(22), category: ['Software', 'Subscription'],        pending: false },
    { transaction_id: 'txn_14', account_id: 'acc_mercury_1', name: 'Stripe payout',         merchant_name: 'Stripe',              amount: -12000.00,date: d(25), category: ['Transfer', 'Credit'],              pending: false },
    { transaction_id: 'txn_15', account_id: 'acc_brex_1',    name: 'Brother Printer',       merchant_name: 'Best Buy',            amount: 349.00,   date: d(30), category: ['Shopping', 'Electronics'],         pending: false },
  ];
}
 
