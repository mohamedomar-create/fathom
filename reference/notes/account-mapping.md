# Account mapping: the 30 classes

Every source line becomes exactly one class. `ingest.py` does this with keyword rules plus the section heading the line sits under; confidence under 0.7 means check it.

## P&L (14)
| Class | What goes in | Watch for |
|---|---|---|
| revenue | Sales, service fees, subscriptions | Returns and discounts allowed are subtracted automatically |
| cos_variable | Goods bought for resale, materials, freight in, direct costs that move with sales | |
| cos_fixed | Direct labour, factory rent, fixed production costs | Salaries inside a Cost of Sales block |
| cos_depreciation | Depreciation inside Cost of Sales | |
| exp_variable | Sales commission, delivery, packaging, card or gateway fees, bank charges | Marketing is treated as fixed (discretionary) unless it is a % of sales |
| exp_fixed | Salaries, rent, utilities, insurance, admin, professional fees, marketing | Default for unknown expense lines |
| exp_depreciation | Depreciation and amortisation in operating expenses | |
| other_income | Gains on disposal, FX gains, sundry income, rental income | Not part of operating profit |
| other_expenses | Losses on disposal, FX losses, write-offs, bad debts, impairment | |
| interest_income / interest_expenses | Bank interest, loan interest, finance charges | Bank charges are NOT interest; they are exp_variable |
| tax_expenses | Income or corporate tax expense | VAT is never an expense; it belongs on the balance sheet |
| adjustments | Prior-period items, one-offs after tax | |
| dividends | Distributions to owners | Not an expense; reduces retained earnings |

## Balance sheet (16)
| Class | What goes in |
|---|---|
| cash | Cash, bank accounts, petty cash, treasury |
| ar | Trade debtors, customers, notes receivable |
| inventory | Stock, finished goods, merchandise |
| wip | Work in progress, contracts in progress |
| other_ca | Prepayments, advances paid, deposits, input VAT, staff advances |
| fixed_assets | Property, equipment, vehicles, furniture, **net of accumulated depreciation** |
| intangibles | Goodwill, software, licences, capitalised development |
| investments | Long-term investments and loans to others |
| std | Overdraft, short-term loans, current portion of long-term debt |
| ap | Trade creditors, suppliers |
| tax_liab | VAT payable, income tax payable, withholding, payroll tax, social insurance |
| other_cl | Accruals, deferred revenue, customer deposits, provisions, amounts due to others |
| ltd | Long-term loans, mortgages, bonds |
| other_ncl | Deferred tax, lease liabilities, end-of-service provisions |
| retained_earnings | Retained and current-year earnings |
| other_equity | Share capital, premium, reserves, owner and partner accounts |

## Rules of thumb
1. A line's **section heading** beats its name when the name is ambiguous ("Bank" under Liabilities is debt, not cash).
2. Accumulated depreciation is a **negative fixed asset**, not an expense. Depreciation expense is a P&L line.
3. Totals and subtotals are dropped: both by name ("Total...", "Net profit") and by arithmetic (a line equal to the sum of the lines below it). Keep an eye on the "skipped" list in the ingest report.
4. When in doubt between fixed and variable: ask "if sales doubled next month, would this line roughly double?" Yes means variable. This split drives the breakeven chart, so it is worth getting right for the 3 to 5 biggest lines.
5. Unknown label: do not guess from one word. Look at the rows around it and the values (a line that moves with revenue is probably variable).

## Mapping override file
```csv
label,class
Customer prepayments,other_cl
Gas & electricity,exp_fixed
```
Labels are matched case-insensitively with leading account codes ignored. Run `ingest.py ... --map mapping.csv`.
