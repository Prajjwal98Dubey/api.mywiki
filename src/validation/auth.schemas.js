import { z } from 'zod';

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{3,30}$/, 'Username must be 3–30 characters: letters, numbers and underscores'),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address')),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required').max(254),
  password: z.string().min(1, 'Password is required').max(200),
});
