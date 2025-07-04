require("dotenv").config();
const express = require("express");
const cors = require("cors"); // Corrected here
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { default: Stripe } = require("stripe");
const verifyFbToken = require("./middlewares/verifyFbToken");
const verifyEmail = require("./middlewares/verifyEmail");
const verifyAdmin = require("./middlewares/verifyAdmin");
const app = express();
const port = process.env.PORT || 3000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(cors());
app.use(express.json());

//

const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASSWORD}@cluster0.mdfhcbd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const database = client.db("parcelDB");
    const parcelCollection = database.collection("parcels");
    const paymentCollection = client.db("parcelDB").collection("payments");
    const userCollection = client.db("parcelDB").collection("users");
    const ridersCollection = client.db("parcelDB").collection("riders");

    // strip apis
    app.post("/create-payment-intent", async (req, res) => {
      const amountInCents = req.body.amountInCents;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents, // Amount in cents
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    // parcel apis
    app.post("/parcels", verifyFbToken,  async (req, res) => {
      const parcel = req.body;

      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    app.get("/my-parcel",  async (req, res) => {
      try {
        const userEmail = req.query.email;

        if (!userEmail) {
          return res
            .status(400)
            .send({ message: "Email query parameter is required." });
        }

        const query = { userEmail: userEmail };
        const userParcels = await parcelCollection.find(query).toArray();

        res.send(userParcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).send({ message: "Internal server error." });
      }
    });

    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid parcel ID" });
        }

        const query = { _id: new ObjectId(id) };
        const parcel = await parcelCollection.findOne(query);

        if (!parcel) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send(parcel);
      } catch (error) {
        console.error("Error fetching parcel:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.patch("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid parcel ID" });
        }

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: updateData,
        };

        const result = await parcelCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send(result);
      } catch (error) {
        console.error("Error updating parcel:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.patch("/parcels/payment-status/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid parcel ID" });
        }

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { payment_status: "paid" },
        };

        const result = await parcelCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send({
          success: true,
          message: "Payment status updated successfully",
          result,
        });
      } catch (error) {
        console.error("Error updating payment status:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // payment apis

    app.post("/payments", async (req, res) => {
      try {
        const paymentInfo = req.body;

        // Example: paymentInfo should have at least:
        // amount, userEmail, transactionId, paymentMethod, paymentDate
        console.log("Received payment info:", paymentInfo);

        const result = await paymentCollection.insertOne(paymentInfo);

        res.send({
          success: true,
          message: "Payment recorded successfully.",
          data: result,
        });
      } catch (error) {
        console.error("Error processing payment:", error);
        res.status(500).send({
          success: false,
          message: "Failed to process payment.",
        });
      }
    });

    app.get("/payments", verifyFbToken, verifyEmail, async (req, res) => {
      try {
        const userEmail = req.query.email;

        if (!userEmail) {
          return res
            .status(400)
            .send({ message: "Email query parameter is required" });
        }

        const query = { email: userEmail };
        const userPayments = await paymentCollection.find(query).toArray();

        res.send(userPayments);
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // users api
    app.post("/users", async (req, res) => {
      try {
        const userData = req.body;
        const userEmail = userData.email;

        if (!userEmail) {
          return res.status(400).send({ message: "Email is required." });
        }

        // Check if user already exists
        const existingUser = await userCollection.findOne({ email: userEmail });

        if (existingUser) {
          return res.send({
            success: false,
            message: "User already exists.",
            user: existingUser,
          });
        }

        // Save new user
        const newUser = {
          name: userData.name,
          email: userData.email,
          photoURL: userData.photoURL,
          role: userData.role || "user", // default role
          creationDate: new Date(),
        };

        const result = await userCollection.insertOne(newUser);

        res.send({
          success: true,
          message: "User saved successfully.",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error saving user:", error);
        res.status(500).send({ message: "Internal server error." });
      }
    });

    app.get("/users", async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });
    // In your Express backend routes file or index.js

    app.get("/user-role", async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).json({ error: "Email query param required" });
      }

      try {
        const user = await userCollection.findOne({ email }); // adjust your DB access here

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        return res.json({ role: user.role || "user" });
      } catch (error) {
        console.error("Error fetching user role:", error);
        return res.status(500).json({ error: "Internal server error" });
      }
    });

    // riders api

    app.post("/riders", async (req, res) => {
      try {
        const riderData = req.body;
        riderData.status = "pending"; // Set status to pending by default

        const result = await ridersCollection.insertOne(riderData);

        res.send({
          success: true,
          message: "Rider application submitted successfully.",
          data: result,
        });
      } catch (error) {
        console.error("Error creating rider:", error);
        res.status(500).send({ message: "Internal server error." });
      }
    });

    app.get("/riders", verifyFbToken , verifyAdmin, async (req, res) => {
      try {
        const status = req.query.status;

        // Require the status query
        if (!status) {
          return res
            .status(400)
            .send({ message: "Status query parameter is required." });
        }

        // Fetch riders with the given status
        const query = { status: status };
        const riders = await ridersCollection.find(query).toArray();

        res.send(riders);
      } catch (error) {
        console.error("Error fetching riders:", error);
        res.status(500).send({ message: "Internal server error." });
      }
    });

    app.patch("/riders/:id", verifyFbToken , verifyAdmin, async (req, res) => {
      try {
        const riderId = req.params.id;
        const updatedStatus = req.body.status;

        if (!ObjectId.isValid(riderId)) {
          return res.status(400).send({ message: "Invalid Rider ID" });
        }

        const filter = { _id: new ObjectId(riderId) };
        const updateDoc = { $set: { status: updatedStatus } };

        const riderResult = await ridersCollection.updateOne(filter, updateDoc);

        if (riderResult.matchedCount === 0) {
          return res.status(404).send({ message: "Rider not found" });
        }

        // Find the rider to get the applicant's email
        const rider = await ridersCollection.findOne({
          _id: new ObjectId(riderId),
        });
        const userEmail = rider?.applicantEmail;

        // Update the user role to "rider"
        const userResult = await userCollection.updateOne(
          { email: userEmail },
          { $set: { role: "rider" } }
        );

        res.send({
          success: true,
          message: "Rider status and user role updated successfully",
          riderUpdate: riderResult,
          userUpdate: userResult,
        });
      } catch (error) {
        console.error("Error updating rider status and user role:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/riders", verifyFbToken , verifyAdmin, async (req, res) => {
      try {
        const status = req.query.status;

        let query = {};
        if (status) {
          query.status = status;
        }

        const activeRiders = await ridersCollection.find(query).toArray();

        res.send(activeRiders);
      } catch (error) {
        console.error("Error fetching riders:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // admin api
    app.patch("/users/admin/:email", verifyFbToken, verifyAdmin, async (req, res) => {
      try {
        const userEmail = req.params.email;

        const filter = { email: userEmail };
        console.log("Updating user with email:", userEmail);

        const updateDoc = { $set: { role: "admin" } };

        const result = await userCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({
          success: true,
          message: "User has been promoted to admin successfully",
          updateResult: result,
        });
      } catch (error) {
        console.error("Error making user admin:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

//

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
