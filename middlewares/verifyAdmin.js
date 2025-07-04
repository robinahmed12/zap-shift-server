const verifyAdmin = async (req, res, next) => {
  const email = req.user?.email;

  if (!email) {
    return res.status(401).send({ message: "Unauthorized: No email found" });
  }

  try {
    const user = await usersCollection.findOne({ email });

    if (!user || user.role !== "admin") {
      return res.status(403).send({ message: "Forbidden: Admins only" });
    }

    next(); // User is admin, proceed to the route
  } catch (error) {
    res.status(500).send({ message: "Internal server error" });
  }
};

module.exports = verifyAdmin;
