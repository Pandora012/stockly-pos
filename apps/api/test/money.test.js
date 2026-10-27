import { expect, it } from 'vitest';
import { saleTotals } from '../../../shared/money.js';

it('calculates IDR tax after discount, rounding half up with integers', () => {
  expect(saleTotals([{ unitPrice: 10005, quantity: 1 }], 5, 1100)).toEqual({ subtotal: 10005, discount: 5, tax: 1100, total: 11100 });
  expect(saleTotals([{ unitPrice: 5, quantity: 1 }], 0, 1000).tax).toBe(1);
  expect(() => saleTotals([{ unitPrice: 1e9, quantity: 10000 }])).toThrow();
  expect(() => saleTotals([{ unitPrice: 5, quantity: 1 }], 6)).toThrow();
});
