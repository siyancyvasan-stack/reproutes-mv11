import { z } from 'zod';
export const loginSchema = z.object({
    body: z.object({
        email: z.string().email().transform((value) => value.toLowerCase()),
        password: z.string().min(8).max(128),
        tenant: z.string().min(2).default('reproutes-demo'),
    }).strict(),
    query: z.object({}).strict(),
    params: z.object({}).strict(),
}).strict();
export const refreshSchema = z.object({
    body: z.object({ refreshToken: z.string().min(32).optional() }).strict().default({}),
    query: z.object({}).strict(),
    params: z.object({}).strict(),
}).strict();
const registrationBody = z.object({
    name: z.string().trim().min(2).max(80),
    email: z.string().email().transform((value) => value.toLowerCase()),
    password: z.string().min(8).max(128)
        .regex(/[A-Z]/, 'Password must include an uppercase letter')
        .regex(/[a-z]/, 'Password must include a lowercase letter')
        .regex(/[0-9]/, 'Password must include a number'),
    tenant: z.string().min(2).default('reproutes-demo'),
}).strict();
const passwordSchema = z.string().min(8).max(128)
    .regex(/[A-Z]/, 'Password must include an uppercase letter')
    .regex(/[a-z]/, 'Password must include a lowercase letter')
    .regex(/[0-9]/, 'Password must include a number');
export const requestRegistrationOtpSchema = z.object({
    body: registrationBody,
    query: z.object({}).strict(),
    params: z.object({}).strict(),
}).strict();
export const verifyRegistrationOtpSchema = z.object({
    body: z.object({
        email: z.string().email().transform((value) => value.toLowerCase()),
        code: z.string().regex(/^\d{6}$/),
        tenant: z.string().min(2).default('reproutes-demo'),
    }).strict(),
    query: z.object({}).strict(),
    params: z.object({}).strict(),
}).strict();
export const requestPasswordResetSchema = z.object({
    body: z.object({
        email: z.string().email().transform((value) => value.toLowerCase()),
        tenant: z.string().min(2).default('reproutes'),
    }).strict(),
    query: z.object({}).strict(),
    params: z.object({}).strict(),
}).strict();
export const resetPasswordSchema = z.object({
    body: z.object({
        email: z.string().email().transform((value) => value.toLowerCase()),
        token: z.string().min(32).max(512),
        password: passwordSchema,
        tenant: z.string().min(2).default('reproutes'),
    }).strict(),
    query: z.object({}).strict(),
    params: z.object({}).strict(),
}).strict();
