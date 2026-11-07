import argon2 from 'argon2';
import bcrypt from 'bcryptjs';

export const hashPassword = (password) => argon2.hash(password);
export const verifyPassword = (password, hash) => {
    if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
        return bcrypt.compare(password, hash);
    }
    return argon2.verify(hash, password);
};
