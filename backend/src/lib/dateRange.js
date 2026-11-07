import { z } from 'zod';
const querySchema = z.object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
});
export const dashboardDateRange = (query, defaultDays = 30) => {
    const parsed = querySchema.parse({ from: query.from, to: query.to });
    const to = parsed.to ? new Date(parsed.to) : new Date();
    const from = parsed.from ? new Date(parsed.from) : new Date(to.getTime() - defaultDays * 86_400_000);
    if (from > to)
        throw new z.ZodError([{ code: 'custom', path: ['from'], message: 'from must be before to' }]);
    const maximumRangeMs = 366 * 86_400_000;
    if (to.getTime() - from.getTime() > maximumRangeMs) {
        throw new z.ZodError([{ code: 'custom', path: ['to'], message: 'Dashboard range cannot exceed 366 days' }]);
    }
    return { from, to };
};
