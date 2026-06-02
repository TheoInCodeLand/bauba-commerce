function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }

    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
}

function requireAdmin(req, res, next) {
    if (req.session.user && req.session.user.is_admin) {
        return next();
    }

    return res.status(403).render('partials/error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this area.'
    });
}

function redirectIfAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return res.redirect('/products');
    }
    next();
}

module.exports = {
    requireAuth,
    requireAdmin,
    redirectIfAuthenticated,
};