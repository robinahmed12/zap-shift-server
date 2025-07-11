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

const uri = `mongodb+srv://${process.env.DB_NAM}:${process.env.DB_PASS}@cluster0.mdfhcbd.mongodb.net/${process.env.DB_NAM}?retryWrites=true&w=majority&appName=Cluster0`;

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
    const trackingCollection = client.db("parcelDB").collection("tracking");

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
    app.post("/parcels", verifyFbToken, async (req, res) => {
      const parcel = req.body;

      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    app.get("/my-parcel", async (req, res) => {
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

    app.get("/parcels/assignable", async (req, res) => {
      try {
        const query = {
          payment_status: "paid",
          delivery_status: "not_collected",
        };
        const parcels = await parcelCollection.find(query).toArray();
        res.send(parcels);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch parcels" });
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

    app.get("/parcels", async (req, res) => {
      try {
        const parcels = await parcelCollection.find().toArray();
        res.send(parcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/parcel-status-counts", async (req, res) => {
      try {
        const statusCounts = await parcelCollection
          .aggregate([
            {
              $facet: {
                // Count by delivery_status
                statusSummary: [
                  { $group: { _id: "$delivery_status", count: { $sum: 1 } } },
                ],
                // Special count: Paid but not assigned
                paidNotAssigned: [
                  {
                    $match: {
                      payment_status: "paid",
                      delivery_status: "not_collected",
                    },
                  },
                  { $count: "count" },
                ],
              },
            },
          ])
          .toArray();

        const result = statusCounts[0];

        res.send({
          success: true,
          statusSummary: result.statusSummary,
          paidNotAssigned: result.paidNotAssigned[0]?.count || 0,
        });
      } catch (error) {
        console.error("Error fetching status counts:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // PATCH route to update cashout status
    app.patch("/parcels/:id/cashout", async (req, res) => {
      try {
        const parcelId = req.params.id;
        const { cashout_status } = req.body;

        if (!ObjectId.isValid(parcelId)) {
          return res.status(400).send({ message: "Invalid Parcel ID" });
        }

        const filter = { _id: new ObjectId(parcelId) };
        const updateDoc = { $set: { cashout_status: cashout_status } };

        const result = await parcelCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send({
          success: true,
          message: "Cashout status updated successfully",
          result,
        });
      } catch (error) {
        console.error("Error updating cashout status:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // PATCH: Update delivery status and timestamps
    app.patch("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { delivery_status } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid parcel ID" });
        }

        const filter = { _id: new ObjectId(id) };
        let updateDoc = { $set: { delivery_status } };

        if (delivery_status === "in_transit") {
          updateDoc.$set.picked_at = new Date();
        } else if (delivery_status === "delivered") {
          updateDoc.$set.delivered_at = new Date();
        }

        const result = await parcelCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send({
          success: true,
          message: "Parcel updated successfully",
          result,
        });
      } catch (error) {
        console.error("Error updating parcel:", error);
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

    // Assign rider to a parcel
    app.patch("/parcels/:id/assign-rider", async (req, res) => {
      try {
        const parcelId = req.params.id;
        const { riderId, riderName, riderPhone, riderEmail } = req.body;

        if (!ObjectId.isValid(parcelId)) {
          return res.status(400).send({ message: "Invalid Parcel ID" });
        }

        const filter = { _id: new ObjectId(parcelId) };
        const updateDoc = {
          $set: {
            assignedRider: {
              riderId,
              riderName,
              riderPhone,
              riderEmail,
            },
            delivery_status: "assigned", // Optionally update status
          },
        };

        const result = await parcelCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send({
          success: true,
          message: "Rider assigned successfully",
          result,
        });
      } catch (error) {
        console.error("Error assigning rider:", error);
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

    app.get("/riders", async (req, res) => {
      try {
        const status = req.query.status;

        if (!status) {
          return res
            .status(400)
            .send({ message: "Status query parameter is required." });
        }

        const query = { status: status };

        const riders = await ridersCollection.find(query).toArray();

        res.send(riders);
      } catch (error) {
        console.error("Error fetching riders:", error);
        res
          .status(500)
          .send({ message: "Internal server error.", error: error.message });
      }
    });

    app.get("/rider-assigned-parcels", async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ message: "Rider email is required" });
        }

        const query = {
          delivery_status: { $in: ["assigned", "in_transit"] }, // Fixed here
          "assignedRider.riderEmail": email,
        };

        const parcels = await parcelCollection.find(query).toArray();
        res.send(parcels);
      } catch (error) {
        console.error("Error fetching assigned parcels:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // Get riders by city
    app.get("/riders-by-city", async (req, res) => {
      try {
        const city = req.query.city;

        if (!city) {
          return res
            .status(400)
            .send({ message: "City query parameter is required" });
        }

        const query = { city: city, status: "active" }; // Only active riders
        const riders = await ridersCollection.find(query).toArray();

        res.send(riders);
      } catch (error) {
        console.error("Error fetching riders by city:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/rider-earnings", async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ message: "Rider email is required" });
        }

        const parcels = await parcelCollection
          .find({
            "assignedRider.riderEmail": email,
            delivery_status: "delivered",
          })
          .toArray();

        res.send(parcels);
      } catch (error) {
        console.error("Error fetching earnings:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.patch("/riders/:id", async (req, res) => {
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

    // GET Completed Deliveries by Rider
    app.get("/rider-completed-parcels", async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ message: "Rider email is required" });
        }

        const query = {
          delivery_status: "delivered",
          "assignedRider.riderEmail": email,
        };

        const parcels = await parcelCollection.find(query).toArray();
        res.send(parcels);
      } catch (error) {
        console.error("Error fetching completed parcels:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // tracikng api
    app.post("/tracking", async (req, res) => {
      try {
        const { tracking_id, status, details, updated_by, timestamp } =
          req.body;

        if (!tracking_id || !status || !details || !updated_by || !timestamp) {
          return res.status(400).send({ message: "All fields are required." });
        }

        const result = await trackingCollection.insertOne({
          tracking_id,
          status,
          details,
          updated_by,
          timestamp: new Date(timestamp), // Or can use server time: new Date()
        });

        res.send({
          success: true,
          message: "Tracking log saved successfully.",
          data: result,
        });
      } catch (error) {
        console.error("Error saving tracking log:", error);
        res.status(500).send({ message: "Internal server error." });
      }
    });

    // admin api
    app.patch(
      "/users/admin/:email",
      verifyFbToken,
      verifyAdmin,
      async (req, res) => {
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
      }
    );

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
