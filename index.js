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

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await userCollection.findOne({ email: email });
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "access forbidden" });
      }
      next();
    };
    const verifyDecorator = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await userCollection.findOne({ email: email });
      if (!user || user.role !== "decorator") {
        return res.status(403).send({ message: "access forbidden" });
      }
      next();
    };

    // admin API'S ---------------------------------------------
    app.get(
      "/admin/analytics",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const incomeRevenue = await bookingCollection
          .aggregate([
            { $match: { paymentStatus: "paid" } },
            { $group: { _id: null, totalIncome: { $sum: "$totalCost" } } },
          ])
          .toArray();
        const serviceWise = await bookingCollection
          .aggregate([
            { $group: { _id: "$serviceName", totalBooked: { $sum: 1 } } },
          ])
          .toArray();
        const totalBookings = await bookingCollection.countDocuments();
        res.send({
          totalIncome: incomeRevenue[0]?.totalIncome || 0,
          totalBookings,
          serviceWise,
        });
      }
    );

    app.get("/users/role/:email", async (req, res) => {
      const { email } = req.params;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

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

    app.post(
      "/services",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const newService = req.body;
        const result = await serviceCollection.insertOne(newService);
        res.send(result);
      }
    );

    app.patch(
      "/services/:id/update",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const editInfo = req.body;
        const { id } = req.params;
        const result = await serviceCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: editInfo }
        );
        res.send(result);
      }
    );

    app.delete(
      "/services/:id/delete",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const result = await serviceCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

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
      const { speciality, workStatus } = req.query;

      let query = { workStatus: "available" };
      if (speciality) {
        query.specialities = { $regex: speciality, $options: "i" };
      }
      if (workStatus === "available") {
        query.workStatus = workStatus;
      }
      const result = await decoratorCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/decorators", async (req, res) => {
      const newDecorator = req.body;
      newDecorator.status = "pending";
      newDecorator.applied_at = new Date();
      const result = await decoratorCollection.insertOne(newDecorator);
      res.send(result);
    });

    app.get(
      "/decorators/select",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { speciality, status } = req.query;
        const query = {};
        if (speciality) {
          query.specialities = { $regex: speciality, $options: "i" };
        }
        if (status) {
          query.status = status;
        }
        const result = await decoratorCollection.find(query).toArray();
        res.send(result);
      }
    );

    app.get(
      "/decorators",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
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
      }
    );

    app.patch(
      "/decorators/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
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
          const removeFromDecorators = await decoratorCollection.deleteOne(
            query
          );

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
      }
    );

    app.delete(
      "/decorators/:id/delete",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const result = await decoratorCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    // bookings API'S -------------------------------------------
    app.post("/bookings", verifyFirebaseToken, async (req, res) => {
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

    app.get("/bookings", verifyFirebaseToken, async (req, res) => {
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

    app.get(
      "/bookings/decorator",
      verifyFirebaseToken,
      verifyDecorator,
      async (req, res) => {
        const { decoratorEmail, status } = req.query;
        const query = {};
        if (decoratorEmail) {
          query.decoratorEmail = decoratorEmail;
        }
        if (status) {
          query.status = status;
        }
        const result = await bookingCollection.find(query).toArray();
        res.send(result);
      }
    );

    app.get(
      "/bookings/decorator/today",
      verifyFirebaseToken,
      verifyDecorator,
      async (req, res) => {
        const email = req.query.email;

        const today = new Date().toISOString().split("T")[0];

        const query = {
          decoratorEmail: email,
          paymentStatus: "paid",
          date: today,
        };

        const result = await bookingCollection
          .find(query)
          .sort({ time: 1 })
          .toArray();

        res.send(result);
      }
    );

    app.get(
      "/bookings/decorator/earnings",
      verifyFirebaseToken,
      verifyDecorator,
      async (req, res) => {
        const email = req.query.email;
        const earningSummary = [
          {
            $match: {
              decoratorEmail: email,
              paymentStatus: "paid",
              status: "completed",
            },
          },
          {
            $group: {
              _id: null,
              totalEarnings: { $sum: "$totalCost" },
              totalCompletedJobs: { $sum: 1 },
            },
          },
        ];
        const result = await bookingCollection
          .aggregate(earningSummary)
          .toArray();
        res.send(result[0]);
      }
    );

    app.patch("/bookings/:bookingId", verifyFirebaseToken, async (req, res) => {
      const id = req.params.bookingId;
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

    app.patch(
      "/bookings/assign-decorator/:bookingId",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { decoratorId, decoratorName, decoratorEmail } = req.body;
        const { bookingId } = req.params;
        const updateInfo = {
          $set: {
            decoratorId,
            decoratorName,
            decoratorEmail,
            status: "decorator assigned",
          },
        };
        const assignResult = await bookingCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          updateInfo
        );

        // update Decorator workStatus
        const decoratorUpdate = await decoratorCollection.updateOne(
          { _id: new ObjectId(decoratorId) },
          { $set: { workStatus: "assigned" } }
        );
        res.send(assignResult);
      }
    );

    app.patch(
      "/bookings/status/:bookingId",
      verifyFirebaseToken,
      verifyDecorator,
      async (req, res) => {
        const status = req.body.status;
        const id = req.params.bookingId;
        const updateInfo = {
          status: status,
        };
        if (status === "pending") {
          updateInfo.decoratorId = null;
          updateInfo.decoratorName = null;
          updateInfo.decoratorEmail = null;
        }
        const result = await bookingCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateInfo }
        );
        res.send(result);
      }
    );

    app.delete(
      "/bookings/:serviceId",
      verifyFirebaseToken,
      async (req, res) => {
        const id = req.params.serviceId;
        const result = await bookingCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    // payment API'S ------------------------------------------
    app.post(
      "/payment-checkout-session",
      verifyFirebaseToken,
      async (req, res) => {
        const paymentInfo = req.body;
        const amount = parseInt(paymentInfo.serviceCost * 100);
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "bdt",
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
          success_url: `${process.env.CLIENT_URL}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_URL}/dashboard/payment-cancel`,
        });
        res.send({ url: session.url });
      }
    );

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
        const update = {
          $set: { paymentStatus: "paid", trackingId, transactionId },
        };

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
