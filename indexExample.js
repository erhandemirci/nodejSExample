// User Service (user-service/index.js)
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const amqp = require("amqplib");
const redis = require("redis");
const app = express();
app.use(express.json());

const redisClient = redis.createClient();
redisClient.connect();
redisClient.on("connect", () => console.log("Redis connected in User Service"));

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("User Service connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

const UserSchema = new mongoose.Schema({ name: String });
const User = mongoose.model("User", UserSchema);

let channel;
async function connectRabbitMQ() {
  const connection = await amqp.connect("amqp://localhost");
  channel = await connection.createChannel();
  await channel.assertQueue("USER_CREATED");
}
connectRabbitMQ();

app.get("/users/:id", async (req, res) => {
  const cachedUser = await redisClient.get(req.params.id);
  if (cachedUser) return res.json(JSON.parse(cachedUser));

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).send("User not found");

  await redisClient.set(req.params.id, JSON.stringify(user), { EX: 60 });
  res.json(user);
});

app.post("/users", async (req, res) => {
  const newUser = new User(req.body);
  await newUser.save();
  channel.sendToQueue("USER_CREATED", Buffer.from(JSON.stringify(newUser)));
  res.status(201).json(newUser);
});

app.listen(3001, () => console.log("User Service running on port 3001"));

// Order Service (order-service/index.js)
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const amqp = require("amqplib");
const redis = require("redis");
const app = express();
app.use(express.json());

const redisClient = redis.createClient();
redisClient.connect();
redisClient.on("connect", () => console.log("Redis connected in Order Service"));

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Order Service connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

const OrderSchema = new mongoose.Schema({ userId: String, product: String });
const Order = mongoose.model("Order", OrderSchema);

let channel;
async function connectRabbitMQ() {
  const connection = await amqp.connect("amqp://localhost");
  channel = await connection.createChannel();
  await channel.assertQueue("USER_CREATED");

  channel.consume("USER_CREATED", async (msg) => {
    const newUser = JSON.parse(msg.content.toString());
    await redisClient.set(newUser._id, JSON.stringify(newUser), { EX: 60 });
    console.log("User Cached in Order Service:", newUser);
  }, { noAck: true });
}
connectRabbitMQ();

app.listen(3002, () => console.log("Order Service running on port 3002"));

// API Gateway (gateway/index.js)
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const app = express();

app.use("/users", createProxyMiddleware({ target: "http://localhost:3001", changeOrigin: true }));
app.use("/orders", createProxyMiddleware({ target: "http://localhost:3002", changeOrigin: true }));

app.listen(3000, () => console.log("API Gateway running on port 3000"));
