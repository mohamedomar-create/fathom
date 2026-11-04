// The business plan engine, ported with the owner's blueprint tests: hand-checked numbers, statements that agree in
// every month and scenario, tax losses, indicators, ratios, the plan check, sensitivity.
import { describe, expect, it } from 'vitest'
import { byYear, cagr, cleanPlan, fundingFix, indicators, irrOf, lineSales, loanPayment, metricOf, moved, planChecks, projectMonths, ratiosOf, sensitivity, sourcesAndUses, type BusinessPlan } from '@/lib/engine/plan'


/** A simple plan whose numbers can be worked out by hand. */
function simple(over: Partial<BusinessPlan> = {}): BusinessPlan {
  return {
    id: 'plan_t', createdBy: 'u_admin', updatedAt: '', ...cleanPlan({
      name: 'Test', startYear: 2027, years: 3, receivableDays: 0, payableDays: 0, stockDays: 0, taxRate: 0, discountRate: 10, openingAssetLife: 0,
      opening: { cash: 100000 },
      lines: [{ name: 'Syringes', units: 1200, price: 100, unitCost: 60, growthUnits: 0, growthPrice: 0 }],
      staff: [{ name: 'Rep', count: 1, salary: 1000, raise: 0, fromMonth: 1 }],
      expenses: [{ name: 'Rent', monthly: 500, growth: 0 }],
      ...over,
    }),
  }
}

describe('the business plan', () => {
  it('turns assumptions into a profit and loss that can be checked by hand', () => {
    const ys = byYear(projectMonths(simple()))
    expect(ys.map((y) => [y.label, y.revenue, y.cogs, y.gross, y.staff, y.overheads, y.net])).toEqual([
      ['2027', 120000, 72000, 48000, 12000, 6000, 30000], ['2028', 120000, 72000, 48000, 12000, 6000, 30000], ['2029', 120000, 72000, 48000, 12000, 6000, 30000],
    ])
    expect(ys.map((y) => y.cash)).toEqual([130000, 160000, 190000])
  })

  it('the balance sheet balances and the cash ties out in every month of every scenario, with everything switched on', () => {
    const p = simple({
      years: 5, receivableDays: 45, payableDays: 30, stockDays: 60, taxRate: 22.5, openingAssetLife: 5,
      opening: { cash: 50000, receivables: 20000, inventory: 30000, fixedAssets: 60000, otherAssets: 5000, payables: 15000, otherLiabilities: 4000, loans: 0 },
      season: [1, 1, 3, 1, 1, 1, 1, 1, 2, 1, 1, 1],
      lines: [{ id: 'a', name: 'A', units: 1000, price: 200, unitCost: 120, growthUnits: 15, growthPrice: 10 }, { id: 'b', name: 'B', units: 50, price: 3000, unitCost: 0, growthUnits: 5, growthPrice: 8 }],
      staff: [{ id: 's', name: 'Team', count: 4, salary: 9000, raise: 12, fromMonth: 1 }, { id: 's2', name: 'New rep', count: 1, salary: 8000, raise: 10, fromMonth: 7 }],
      expenses: [{ id: 'e', name: 'Rent', monthly: 6000, growth: 10 }],
      capex: [{ id: 'c', name: 'Van', amount: 400000, month: 3, lifeYears: 5 }],
      loans: [{ id: 'l0', name: 'Existing', amount: 80000, month: 0, rate: 18, termMonths: 24, graceMonths: 0 }, { id: 'l1', name: 'Bank loan', amount: 300000, month: 3, rate: 20, termMonths: 36, graceMonths: 6 }],
      equity: [{ id: 'q', name: 'Partners', amount: 100000, month: 2 }],
    })
    // The loans list is what is owed at the start.
    expect(p.opening.loans).toBe(80000)
    for (const sc of ['base', 'best', 'worst'] as const) {
      const ms = projectMonths(p, sc)
      expect(ms.length).toBe(60)
      for (const m of ms) expect(Math.abs(m.check), `${sc} ${m.label}`).toBeLessThan(0.05)
      // Cash at the end of each month = the start plus the month's cash flow.
      let cash = p.opening.cash
      // (each month's figures are rounded to the piaster, so up to half a piaster a month can add up)
      ms.forEach((m, i) => { cash += m.netCash; expect(Math.abs(cash - m.cash), `${sc} ${m.label} cash`).toBeLessThan(0.006 * (i + 1)) })
    }
    const ms = projectMonths(p)
    // The bank loan: no interest before it is drawn; repaid in full by the end of its 36 months after 6 of grace.
    expect(ms[0].interest).toBe(round(80000 * 0.18 / 12))
    expect(ms[2 + 6 + 36].loans).toBe(0)
    // Income tax: booked in December, paid the April after.
    expect(ms.every((m, i) => i % 12 === 11 || m.tax === 0)).toBe(true)
    // The best case beats the base, the worst is below it.
    const net = (sc: 'base' | 'best' | 'worst') => byYear(projectMonths(p, sc)).reduce((s, y) => s + y.net, 0)
    expect(net('best')).toBeGreaterThan(net('base'))
    expect(net('worst')).toBeLessThan(net('base'))
  })

  it('a loss year is carried forward against the next year’s tax', () => {
    const p = simple({ taxRate: 20, staff: [{ id: 's', name: 'Team', count: 1, salary: 6000, raise: 0, fromMonth: 1 }] })
    // Year 1: 48,000 gross − 72,000 staff − 6,000 rent = −30,000; from year 2 the staff cost is gone (a −100% raise).
    const p2 = { ...p, staff: [{ id: 's', name: 'Team', count: 1, salary: 6000, raise: -100, fromMonth: 1 }] }
    const ys = byYear(projectMonths(p2))
    expect(ys.map((y) => y.ebt)).toEqual([-30000, 42000, 42000])
    expect(ys.map((y) => y.tax)).toEqual([0, 2400, 8400])
    // Booked in December, paid the April after.
    const ms = projectMonths(p2)
    expect([ms[23].taxPayable, ms[26].taxPayable, ms[27].taxPayable]).toEqual([2400, 2400, 0])
  })

  it('indicators: funding needed, break-even, NPV, IRR and payback', () => {
    const p = simple({ capex: [{ id: 'c', name: 'Machine', amount: 150000, month: 1, lifeYears: 0 }] })
    const ind = indicators(p, projectMonths(p))
    expect(ind.minCash).toBeLessThan(0)
    expect(ind.fundingNeeded).toBe(-ind.minCash)
    expect(ind.minCashMonth).toBe('2027-01')
    // Fixed costs 18,000 a year ÷ 40% contribution margin.
    expect(ind.breakEven).toBe(45000)
    expect(ind.freeCash).toEqual([-120000, 30000, 30000])
    expect(ind.payback).toBeNull()
    expect(irrOf([-100, 60, 60])).toBeCloseTo(13.07, 1)
    expect(irrOf([10, 20])).toBeNull()
    const good = indicators(simple({ capex: [{ id: 'c', name: 'Machine', amount: 40000, month: 1, lifeYears: 0 }] }), projectMonths(simple({ capex: [{ id: 'c', name: 'Machine', amount: 40000, month: 1, lifeYears: 0 }] })))
    expect(good.freeCash).toEqual([-10000, 30000, 30000])
    expect(good.payback).toBe(1.3)
    expect(good.npv).toBe(round(-10000 / 1.1 + 30000 / 1.21 + 30000 / 1.331))
  })

})

function round(n: number) {
  return Math.round(n * 100) / 100
}

describe('reading the plan: ratios, checks, sensitivity', () => {
  const full = () => simple({
    years: 5, receivableDays: 45, payableDays: 30, stockDays: 60, taxRate: 22.5, openingAssetLife: 5,
    opening: { cash: 50000, receivables: 20000, inventory: 30000, fixedAssets: 60000, otherAssets: 5000, payables: 15000, otherLiabilities: 4000, loans: 0 },
    lines: [{ id: 'a', name: 'A', units: 1000, price: 200, unitCost: 120, growthUnits: 15, growthPrice: 10 }, { id: 'b', name: 'B', units: 50, price: 3000, unitCost: 0, growthUnits: 5, growthPrice: 8 }],
    staff: [{ id: 's', name: 'Team', count: 4, salary: 9000, raise: 12, fromMonth: 1 }],
    expenses: [{ id: 'e', name: 'Rent', monthly: 6000, growth: 10 }],
    capex: [{ id: 'c', name: 'Van', amount: 400000, month: 3, lifeYears: 5 }],
    loans: [{ id: 'l1', name: 'Bank loan', amount: 300000, month: 3, rate: 20, termMonths: 36, graceMonths: 6 }],
    equity: [{ id: 'q', name: 'Partners', amount: 100000, month: 2 }],
  })

  it('each product line’s sales add up to the plan’s sales, in every scenario', () => {
    const p = full()
    for (const sc of ['base', 'best', 'worst'] as const) {
      const ys = byYear(projectMonths(p, sc))
      const ls = lineSales(p, sc)
      ys.forEach((y, i) => expect(Math.abs(ls.reduce((s, l) => s + l.years[i], 0) - y.revenue)).toBeLessThan(0.1))
    }
  })

  it('works out the ratios a bank reads, by hand on the simple plan', () => {
    const r = ratiosOf(byYear(projectMonths(simple())))
    expect(r[0]).toMatchObject({ growth: null, grossMargin: 40, ebitdaMargin: 25, netMargin: 25, dscr: null, debtToEquity: 0 })
    expect(r[1].growth).toBe(0)
    // Equity: 100,000 at the start plus 30,000 a year.
    expect(r[0].roe).toBe(23.1)
  })

  it('the cash flow parts add up: investments, loans drawn and repaid, capital put in', () => {
    const p = full()
    const ms = projectMonths(p)
    for (const m of ms) {
      expect(Math.abs(m.investing + m.capex)).toBeLessThan(0.01)
      expect(Math.abs(m.financing - (m.draws - m.principal + m.capitalIn))).toBeLessThan(0.02)
    }
    const su = sourcesAndUses(p, ms)
    const sum = (xs: { value: number }[]) => xs.reduce((s, x) => s + x.value, 0)
    expect(Math.abs(sum(su.sources) - sum(su.uses))).toBeLessThan(1)
  })

  it('the plan check says when cash runs out, and the fix it offers covers the gap', () => {
    const p = simple({ opening: { cash: 0 } as BusinessPlan['opening'], capex: [{ id: 'c', name: 'Machine', amount: 200000, month: 2, lifeYears: 10 }] })
    const ms = projectMonths(p)
    const ind = indicators(p, ms)
    expect(ind.fundingNeeded).toBeGreaterThan(0)
    expect(ind.firstShortMonth).toBe(2)
    const checks = planChecks(p, ms)
    expect(checks[0]).toMatchObject({ id: 'cash', level: 'critical', fix: 'fund' })
    const fix = fundingFix(ms, ind)!
    expect(fix.amount).toBeGreaterThanOrEqual(ind.fundingNeeded)
    const fixed: BusinessPlan = { ...p, equity: [...p.equity, { id: 'x', name: 'More capital', amount: fix.amount, month: fix.month }] }
    expect(indicators(fixed, projectMonths(fixed)).fundingNeeded).toBe(0)
    expect(planChecks(fixed, projectMonths(fixed)).find((c) => c.id === 'cash')?.level).toBe('good')
  })

  it('a healthy plan passes, with the warnings first when there are any', () => {
    const checks = planChecks(simple(), projectMonths(simple()))
    expect(checks.map((c) => c.level).every((l) => l === 'good')).toBe(true)
    const thin = simple({ lines: [{ id: 't', name: 'Thin', units: 1200, price: 100, unitCost: 90, growthUnits: 0, growthPrice: 0 }] })
    const t = planChecks(thin, projectMonths(thin))
    expect(t[0].level).not.toBe('good')
    expect(t.some((c) => c.id === 'margin' && c.level === 'warning')).toBe(true)
  })

  it('sensitivity: prices up raise the value, costs up lower it, biggest effect first', () => {
    const p = full()
    const rows = sensitivity(p, 'npv', 0.1)
    expect(rows.map((r) => r.spread)).toEqual([...rows.map((r) => r.spread)].sort((a, b) => b - a))
    const price = rows.find((r) => r.id === 'price')!
    const cost = rows.find((r) => r.id === 'cost')!
    expect(price.high).toBeGreaterThan(price.base)
    expect(price.low).toBeLessThan(price.base)
    expect(cost.high).toBeLessThan(cost.base)
    expect(rows[0].base).toBe(metricOf(p, 'npv'))
    expect(metricOf(moved(p, 'units', 0), 'profit')).toBe(metricOf(p, 'profit'))
  })

  it('a loan’s instalment, and growth a year', () => {
    expect(loanPayment({ amount: 120000, rate: 0, termMonths: 12 })).toBe(10000)
    expect(loanPayment({ amount: 300000, rate: 20, termMonths: 36 })).toBeCloseTo(11149.08, 1)
    expect(cagr(100, 121, 3)).toBe(10)
    expect(cagr(0, 121, 3)).toBeNull()
  })
})
