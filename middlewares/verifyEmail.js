const verifyEmail = (req, res, next) => {
  const requestEmail = req.query.email || req.body.email;
  const userEmail = req.user?.email;

  if (requestEmail !== userEmail) {
    return res.status(403).send({ message: "Forbidden: Email mismatch." });
  }

  next();
};

module.exports = verifyEmail;
