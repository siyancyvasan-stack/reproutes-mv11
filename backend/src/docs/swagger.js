export const swaggerDocument = {
    openapi: '3.1.0',
    info: {
        title: 'Reproutes API',
        version: '1.0.0',
        description: 'Tenant-aware sales agent tracking and order management API',
    },
    servers: [{ url: '/api/v1' }],
    components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        schemas: {
            Error: {
                type: 'object',
                properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } },
            },
        },
    },
    paths: {
        '/auth/login': {
            post: {
                summary: 'Authenticate a user',
                requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' }, tenant: { type: 'string' } } } } } },
                responses: { '200': { description: 'Authenticated' }, '401': { description: 'Invalid credentials' } },
            },
        },
        '/agents': { get: { security: [{ bearerAuth: [] }], summary: 'List agents', responses: { '200': { description: 'Paginated agents' } } } },
        '/products': { get: { security: [{ bearerAuth: [] }], summary: 'List products', responses: { '200': { description: 'Paginated products' } } } },
        '/orders': {
            get: { security: [{ bearerAuth: [] }], summary: 'List orders', responses: { '200': { description: 'Paginated orders' } } },
            post: { security: [{ bearerAuth: [] }], summary: 'Create an order', responses: { '201': { description: 'Order created' } } },
        },
        '/tracking/latest': { get: { security: [{ bearerAuth: [] }], summary: 'Latest agent locations', responses: { '200': { description: 'Agent telemetry' } } } },
        '/analytics/dashboard': { get: { security: [{ bearerAuth: [] }], summary: 'Dashboard analytics', responses: { '200': { description: 'Analytics KPIs' } } } },
    },
};
