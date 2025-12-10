const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@devcluster.k7riodd.mongodb.net/?appName=DevCluster`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const styleDecorDB = client.db("styleDecorDB");
    const userCollection = styleDecorDB.collection("users");
    const serviceCollection = styleDecorDB.collection("services");
    const decoratorCollection = styleDecorDB.collection("decorators");
    const bookingCollection = styleDecorDB.collection("bookings");

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

    app.patch("/bookings-update/:serviceId", async (req, res) => {
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

    app.delete("/bookings-delete/:serviceId", async (req, res) => {
      const id = req.params.serviceId;
      const result = await bookingCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
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
