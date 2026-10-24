import type { BusinessSettings, Product, TaxSnapshot } from '@/api/types';

/**
 * The GST rate the server will charge for a product right now, mirroring backend TaxResolver.for_product:
 * its tax class → legacy per-product rate → the business default class → settings.default_tax_rate.
 * Composition / unregistered businesses charge no GST. Used only for previews; the server prices every bill.
 */
export function resolveTaxRate(
  product: Pick<Product, 'tax_rate'> & { tax_class_id?: string | null },
  tax: TaxSnapshot | null | undefined,
  settings: Pick<BusinessSettings, 'default_tax_rate'> | null | undefined,
  at: Date = new Date(),
): number {
  if (tax && tax.registration !== 'regular') return 0;
  const classRate = (id: string | null | undefined): number | null => {
    if (!id || !tax) return null;
    const cls = tax.classes.find((c) => c.id === id);
    if (!cls) return null;
    let current: { effective_from: string; total_rate: number } | null = null;
    for (const r of cls.rates) {
      if (Date.parse(r.effective_from) <= at.getTime() && (!current || r.effective_from > current.effective_from)) current = r;
    }
    return current ? current.total_rate : null;
  };
  return classRate(product.tax_class_id)
    ?? product.tax_rate
    ?? classRate(tax?.default_tax_class_id)
    ?? settings?.default_tax_rate
    ?? 0;
}
