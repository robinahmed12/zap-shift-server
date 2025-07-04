const admin = require('firebase-admin');
const serviceAccount = require('./zapshift-auth-firebase.json'); // No 'assert' needed in CommonJS

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

module.exports = admin; // CommonJS export
