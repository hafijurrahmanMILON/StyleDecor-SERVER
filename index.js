const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const crypto = require("crypto");
const admin = require("firebase-admin");

// const serviceAccount = require("./style-decor-firebase.json");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@devcluster.k7riodd.mongodb.net/?appName=DevCluster`;

function generateTrackingId() {
  const prefix = "SD";

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `${prefix}-${date}-${randomHex}`;
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyFirebaseToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  try {
    const tokenId = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(tokenId);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
};

async function run() {
  try {
    // await client.connect();
    const styleDecorDB = client.db("styleDecorDB");
    const userCollection = styleDecorDB.collection("users");
    const serviceCollection = styleDecorDB.collection("services");
    const decoratorCollection = styleDecorDB.collection("decorators");
    const bookingCollection = styleDecorDB.collection("bookings");
    const paymentCollection = styleDecorDB.collection("payments");

    // users API'S ---------------------------------------------
    app.post("/users", async (req, res) => {
      const newUser = req.body;
      newUser.role = "user";
      newUser.createdAt = new Date();
      const existedUser = await userCollection.findOne({
        email: newUser.email,
      });
      if (existedUser) {
        return res.send({ message: "user already exist!" });
      }

      const result = await userCollection.insertOne(newUser);
      res.send();
    });

    // service API'S --------------------------------------------
    app.get("/featured-services", async (req, res) => {
      const result = await serviceCollection.find().limit(8).toArray();
      res.send(result);
    });

    app.get("/all-services", async (req, res) => {
      const { searchText, serviceType, maxBudget, minBudget } = req.query;
      const query = {};
      if (searchText) {
        query.service_name = { $regex: searchText, $options: "i" };
      }
      if (serviceType) {
        query.service_category = serviceType;
      }
      if (minBudget || maxBudget) {
        query.cost = {};
        if (minBudget) {
          query.cost.$gte = parseFloat(minBudget);
        }
        if (maxBudget) {
          query.cost.$lte = parseFloat(maxBudget);
        }
      }
      const result = await serviceCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/services/:id", async (req, res) => {
      const { id } = req.params;
      const result = await serviceCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.post("/services", async (req, res) => {
      const newService = req.body;
      const result = await serviceCollection.insertOne(newService);
      res.send(result);
    });

    app.patch("/services/:id/update", async (req, res) => {
      const editInfo = req.body;
      const { id } = req.params;
      const result = await serviceCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: editInfo }
      );
      res.send(result);
    });

    // decorator API'S -------------------------------------------
    app.get("/best-decorators", async (req, res) => {
      const result = await decoratorCollection
        .find()
        .limit(6)
        .sort({ applied_at: 1 })
        .toArray();
      res.send(result);
    });

    app.get("/available-decorators", async (req, res) => {
      const { speciality } = req.query;

      let query = { workStatus: "available" };
      if (speciality) {
        query.specialities = { $regex: speciality, $options: "i" };
      }
      const result = await decoratorCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/decorators", async (req, res) => {
      const newDecorator = req.body;
      const email = (newDecorator.status = "pending");
      newDecorator.applied_at = new Date();
      const result = await decoratorCollection.insertOne(newDecorator);
      res.send(result);
    });

    app.get("/decorators", async (req, res) => {
      const status = req.query.status;
      const query = {};
      if (status) {
        query.status = { $in: status.split(",") };
      }
      const result = await decoratorCollection
        .find(query)
        .sort({ applied_at: -1 })
        .toArray();
      res.send(result);
    });

    app.patch("/decorators/:id", async (req, res) => {
      const id = req.params.id;
      const { status, email } = req.body;
      const query = { _id: new ObjectId(id) };

      // if request declined before accepting
      if (status === "cancelled") {
        const result = await decoratorCollection.updateOne(query, {
          $set: {
            status,
          },
        });
        return res.send(result);
      }

      // if removed from decorator
      if (status === "removed") {
        const removeFromDecorators = await decoratorCollection.deleteOne(query);

        const roleUpdateResult = await userCollection.updateOne(
          { email },
          {
            $set: {
              role: "user",
            },
          }
        );
        return res.send(removeFromDecorators);
      }

      // if decorator request approved

      const updateResult = await decoratorCollection.updateOne(query, {
        $set: {
          status,
          workStatus: "available",
        },
      });
      if (status === "approved") {
        const updateRole = await userCollection.updateOne(
          { email },
          {
            $set: {
              role: "decorator",
            },
          }
        );
      }

      res.send(updateResult);
    });

    app.delete("/decorators/:id/delete", async (req, res) => {
      const { id } = req.params;
      const result = await decoratorCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // bookings API'S -------------------------------------------
    app.post("/bookings", async (req, res) => {
      const newBookings = req.body;
      const exist = await bookingCollection.findOne({
        customerEmail: newBookings.customerEmail,
        serviceId: newBookings?.serviceId,
        date: newBookings?.date,
        time: newBookings?.time,
      });
      if (exist) {
        return res.send({
          message: "This service already booked at same time!",
        });
      }
      newBookings.orderedAt = new Date();
      const result = await bookingCollection.insertOne(newBookings);
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      const { email } = req.query;
      const query = {};
      if (email) {
        query.customerEmail = email;
      }
      const result = await bookingCollection
        .find(query)
        .sort({ orderedAt: -1 })
        .toArray();
      res.send(result);
    });

    app.patch("/bookings/:serviceId", async (req, res) => {
      const id = req.params.serviceId;
      const { serviceType, date, time, notes, location, totalUnit, totalCost } =
        req.body;
      const updateInfo = {
        $set: {
          serviceType,
          date,
          time,
          notes,
          location,
          totalUnit,
          totalCost,
        },
      };
      const result = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        updateInfo
      );
      res.send(result);
    });

    app.delete("/bookings/:serviceId", async (req, res) => {
      const id = req.params.serviceId;
      const result = await bookingCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // payment API'S ------------------------------------------
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.serviceCost * 100);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.serviceName,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          bookingId: paymentInfo.bookingId,
          serviceName: paymentInfo.serviceName,
        },
        mode: "payment",
        customer_email: paymentInfo.customerEmail,
        success_url: `${process.env.CLIENT_URL}dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL}dashboard/payment-cancel`,
      });
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const session_id = req.query.session_id;
      const trackingId = generateTrackingId();
      const session = await stripe.checkout.sessions.retrieve(session_id);
      console.log(session);

      const transactionId = session.payment_intent;
      const existedPayment = await paymentCollection.findOne({
        transactionId: transactionId,
      });
      if (existedPayment) {
        return res.send({
          message: "already paid",
          transactionId,
          trackingId: existedPayment.trackingId,
        });
      }

      if (session.payment_status === "paid") {
        const bookingId = session.metadata.bookingId;
        const query = { _id: new ObjectId(bookingId) };
        const update = { $set: { paymentStatus: "paid", trackingId } };

        const updateResult = await bookingCollection.updateOne(query, update);

        const paymentData = {
          amount: session.amount_total / 100,
          transactionId,
          currency: session.currency,
          customerEmail: session.customer_email,
          bookingId: session.metadata.bookingId,
          serviceName: session.metadata.serviceName,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId,
        };
        const paymentResult = await paymentCollection.insertOne(paymentData);
        return res.send({
          success: true,
          updateResult,
          paymentResult,
          trackingId,
          transactionId,
        });
      }

      res.send({ success: false });
    });

    app.get("/payment-history", verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "access forbidden" });
        }
      }
      const result = await paymentCollection
        .find(query)
        .sort({ paidAt: -1 })
        .toArray();
      res.send(result);
    });

    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
  }
}

run().catch(console.dir);

app.get("/", async (req, res) => {
  res.send("server running fine");
});
app.listen(port, () => {
  console.log("port:", port);
});
