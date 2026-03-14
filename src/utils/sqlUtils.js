const stripComments = (sql) => {
    const withoutBlock = sql.replace(/\/\*[\s\S]*?\*\//g, '');
    return withoutBlock.replace(/--.*$/gm, '');
};

const splitStatements = (sql) => {
    return sql
        .split(/;\s*(?:\r?\n|$)/)
        .map((stmt) => stmt.trim())
        .filter((stmt) => stmt.length > 0);
};

module.exports = {
    stripComments,
    splitStatements
};
