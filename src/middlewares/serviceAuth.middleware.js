module.exports = (expectedToken) => (req, res, next) => {
    const token = req.headers['x-service-token'];

    if (!expectedToken) {
        return next();
    }

    if (!token || token !== expectedToken) {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized service'
        });
    }

    return next();
};
