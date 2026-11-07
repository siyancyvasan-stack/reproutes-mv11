import xss from 'xss';

/**
 * Recursively sanitizes object values (strings) to prevent XSS.
 * Mutates the object in place.
 */
const sanitizeObj = (obj) => {
    if (!obj || typeof obj !== 'object') {
        return;
    }
    
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            if (typeof obj[i] === 'string') {
                obj[i] = xss(obj[i]);
            } else if (typeof obj[i] === 'object' && obj[i] !== null) {
                sanitizeObj(obj[i]);
            }
        }
    } else {
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                if (typeof obj[key] === 'string') {
                    obj[key] = xss(obj[key]);
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    sanitizeObj(obj[key]);
                }
            }
        }
    }
};

/**
 * Express middleware to sanitize incoming request payload (body, query, params)
 * against Cross-Site Scripting (XSS) attacks.
 */
export const sanitizeInput = (req, res, next) => {
    if (req.body) sanitizeObj(req.body);
    if (req.query) sanitizeObj(req.query);
    if (req.params) sanitizeObj(req.params);
    
    next();
};
