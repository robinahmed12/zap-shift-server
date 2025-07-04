const admin = require("../firebase");

const verifyFbToken = async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return res
      .status(401)
      .send({ message: "Unauthorized: No token provided." });
  }
console.log(hi);

  const token = authorization.split(" ")[1];

  

  try {
    const decodedUser = await admin.auth().verifyIdToken(token);
    req.user = decodedUser;
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    res.status(401).send({ message: "Unauthorized: Invalid token." });
  }
};

module.exports = verifyFbToken;
