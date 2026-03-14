const crypto = require('crypto');

const generateSchemaName = (clientName) => {
    if (!clientName) {
        throw new Error('Client name is required');
    }

    // Sanitize: lowercase, replace spaces/special with underscore
    const sanitized = clientName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    if (!sanitized) {
        throw new Error('Invalid client name');
    }

    // Limit base length
    const base = sanitized.length > 15 ? sanitized.substring(0, 15) : sanitized;

    // Add unique identifier
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(2).toString('hex');
    const identifier = `${timestamp}${random}`.substring(0, 8);

    const schemaName = `${base}_${identifier}`;

    if (schemaName.length > 63) {
        return schemaName.substring(0, 63);
    }

    return schemaName;
};

const isValidSchemaName = (schemaName) => {
    if (!schemaName || schemaName.length < 3 || schemaName.length > 63) {
        return false;
    }
    return /^[a-z][a-z0-9_]*$/.test(schemaName);
};

module.exports = {
    generateSchemaName,
    isValidSchemaName
};
