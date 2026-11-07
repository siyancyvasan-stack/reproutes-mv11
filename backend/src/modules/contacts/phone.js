export const normalizeInternationalNumber = (value, countryCode = '94') => {
    const digits = value.replace(/\D/g, '');
    const code = countryCode.replace(/\D/g, '');
    if (!digits || !code)
        return null;
    const normalized = digits.startsWith('00')
        ? digits.slice(2)
        : digits.startsWith('0')
            ? `${code}${digits.slice(1)}`
            : digits;
    return /^\d{8,15}$/.test(normalized) ? normalized : null;
};
