export const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse({ body: req.body, query: req.query, params: req.params });
    if (!result.success) {
        return res.status(422).json({
            error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: result.error.flatten() },
        });
    }
    const validated = result.data;
    if (validated.body !== undefined)
        req.body = validated.body;
    if (validated.params !== undefined)
        req.params = validated.params;
    if (validated.query !== undefined)
        Object.assign(req.query, validated.query);
    return next();
};
