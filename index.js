const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const User = require("./models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const fs = require("fs");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");
const EventEmitter = require("events");
const amqp = require('amqplib/callback_api');

require("dotenv").config();
const app = express();

const bcryptSalt = bcrypt.genSaltSync(10);
const jwtSecret = "bksdfb2h832h8932";

app.use(express.json());
app.use(cookieParser());
const corsOptions = {
  origin: "http://localhost:5173",
  credentials: true,
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};

app.use(cors(corsOptions));

mongoose.connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch((error) => console.error('Error connecting to MongoDB:', error));

  const Customer = mongoose.model('Customer', new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
  }));
  
  const Order = mongoose.model('Order', new mongoose.Schema({
    customerId: mongoose.Schema.Types.ObjectId,
    product: String,
    amount: Number,
  }));
  
  const Campaign = mongoose.model('Campaign', new mongoose.Schema({
    name: String,
    criteria: Object,
    createdAt: { type: Date, default: Date.now },
  }));
  
  const Audience = mongoose.model('Audience', new mongoose.Schema({
    name: String,
    rules: Array,
    logic: String
  }));
  
  const CommunicationLog = mongoose.model('CommunicationLog', new mongoose.Schema({
    audienceId: mongoose.Schema.Types.ObjectId,
    customerId: mongoose.Schema.Types.ObjectId,
    status: { type: String, default: 'PENDING' },
    createdAt: { type: Date, default: Date.now },
  }));
  

EventEmitter.defaultMaxListeners = 15;
function getUserDataFromReq(req) {
  return new Promise((resolve, reject) => {
    jwt.verify(req.cookies.token, jwtSecret, {}, async (err, userData) => {
      if (err) {
        reject(err);
      } else {
        resolve(userData);
      }
    });
  });
}

app.get("/test", (req, res) => {
  res.json("test ok");
});

app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const userDoc = await User.create({
      name,
      email,
      password: bcrypt.hashSync(password, bcryptSalt),
      role: "user", // Set role to 'user' for regular user registration
    });
    res.json(userDoc);
  } catch (e) {
    res.status(422).json(e);
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const userDoc = await User.findOne({ email: email, role: "user" });

    if (userDoc) {
      const passOk = bcrypt.compareSync(password, userDoc.password);

      if (passOk) {
        jwt.sign(
          {
            email: userDoc.email,
            id: userDoc._id,
            role: userDoc.role, // Add role to the token payload
          },
          jwtSecret,
          {},
          (err, token) => {
            if (err) throw err;
            res.cookie("token", token).json(userDoc);
          }
        );
      } else {
        res.status(422).json("Password is incorrect");
      }
    } else {
      res.status(404).json("User not found");
    }
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/user-role/:email", (req, res) => {
  const { email } = req.params;
  const user = users.find((user) => user.email === email);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json({ role: user.role });
});


app.get("/profile", async (req, res) => {
  const { token } = req.cookies;

  if (token) {
    jwt.verify(token, jwtSecret, {}, async (err, userData) => {
      if (err) {
        console.error("JWT verification error:", err);
        return res.status(403).json({ error: "Unauthorized" });
      }

      const user = await User.findById(userData.id);

      if (user) {
        const { _id, role, userName, name, email } = user;

        if (role === "admin" && userName) {
          return res.json({ _id, role, userName });
        } else if (role === "user" && name && email) {
          return res.json({ _id, role, name, email });
        } else {
          return res.status(404).json("Invalid User");
        }
      } else {
        return res.status(404).json("User not found");
      }
    });
  } else {
    res.json(null);
  }
});



let channel = null;
amqp.connect('amqp://guest:guest@127.0.0.1:5672', (err, connection) => {
  if (err) {
    throw err;
  }
  connection.createChannel((err, ch) => {
    if (err) {
      throw err;
    }
    channel = ch;
    channel.assertQueue('customerQueue', { durable: false });
    channel.assertQueue('orderQueue', { durable: false });
    channel.assertQueue('audienceQueue', { durable: false });
    channel.assertQueue('campaignQueue', { durable: false });

    // Customer consumer
   // Wait for 5 seconds before starting the channel consume
setTimeout(() => {
  // Consumer for customerQueue
  channel.consume('customerQueue', (msg) => {
    const customerData = JSON.parse(msg.content.toString());
    const customer = new Customer(customerData);
    customer.save()
      .then(() => {
        console.log('Customer data ingested');
      })
      .catch((err) => {
        console.error('Failed to ingest customer data:', err);
      });
  }, { noAck: true });

 // Consumer for orderQueue
  channel.consume('orderQueue', (msg) => {
    const orderData = JSON.parse(msg.content.toString());
    const order = new Order(orderData);
    order.save()
      .then(() => {
        console.log('Order data ingested');
      })
      .catch((err) => {
        console.error('Failed to ingest order data:', err);
      });
  }, { noAck: true });

  channel.consume('campaignQueue', async (msg) => {
    const campaignData = JSON.parse(msg.content.toString());
    try {
      const newCampaign = new Campaign(campaignData);
      await newCampaign.save();
      console.log('New campaign created:', newCampaign);

    } catch (error) {
      console.error('Failed to create campaign', error);
    }
  }, { noAck: true });

  channel.consume('audienceQueue', async (msg) => {
    const audienceData = JSON.parse(msg.content.toString());
    try {
      const newAudience = new Audience(audienceData);
      await newAudience.save();
      console.log('New audience created:', newAudience);

      // Fetch customers based on rules and logic
      const query = newAudience.rules.map(rule => ({
        [rule.field]: { [rule.operator]: rule.value }
      }));
      const customers = newAudience.logic === 'AND'
        ? await Customer.find({ $and: query })
        : await Customer.find({ $or: query });

      // Log communications
      const logs = customers.map(customer => ({
        audienceId: newAudience._id,
        customerId: customer._id
      }));
      await CommunicationLog.insertMany(logs);
      console.log('Communication logs created:', logs);

      // Trigger dummy vendor API
      logs.forEach(log => triggerVendorAPI(log));

    } catch (error) {
      console.error('Failed to create audience', error);
    }
  }, { noAck: true });

}, 110000);
  });
});

// API to ingest customer data
app.post('/api/customer', (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email || !phone) {
    return res.status(400).send('Invalid input');
  }
  channel.sendToQueue('customerQueue', Buffer.from(JSON.stringify(req.body)));
  console.log('Sent to customerQueue:', req.body); // Log message
  res.status(202).send('Customer data received');
});

// API to ingest order data
app.post('/api/order', (req, res) => {
  const { customerId, product, amount } = req.body;
  if (!customerId || !product || !amount) {
    return res.status(400).send('Invalid input');
  }
  channel.sendToQueue('orderQueue', Buffer.from(JSON.stringify(req.body)));
  console.log('Sent to orderQueue:', req.body); // Log message
  res.status(202).send('Order data received');
});


app.get('/api/customers', async (req, res) => {
  try {
    const customers = await Customer.find({});
    res.json(customers);
  } catch (error) {
    res.status(500).send('Failed to fetch customers');
  }
});



app.post('/api/delivery-receipt', async (req, res) => {
  const { communicationLogId, status } = req.body;
  try {
    await CommunicationLog.findByIdAndUpdate(communicationLogId, { status });
    console.log('Delivery status updated for communication log:', communicationLogId, 'Status:', status);
    res.status(200).send('Delivery status updated');
  } catch (error) {
    console.error('Failed to update delivery status for communication log:', communicationLogId, 'Error:', error);
    res.status(500).send('Failed to update delivery status');
  }
});



const triggerVendorAPI = async (log) => {
  try {
    const status = Math.random() < 0.9 ? 'SENT' : 'FAILED';
    await axios.post('http://localhost:3000/api/delivery-receipt', {
      communicationLogId: log._id,
      status
    });
    console.log('Vendor API called for communication log:', log._id, 'with status:', status);
  } catch (error) {
    console.error('Failed to trigger vendor API for communication log:', log._id, 'Error:', error);
  }
};






app.post('/api/audience', async (req, res) => {
  const { name, rules, logic } = req.body;
  if (!name || !rules || !logic) {
    return res.status(400).send('Invalid input');
  }

  try {
    const newAudience = new Audience({ name, rules, logic });
    await newAudience.save();
    console.log('New audience created:', newAudience);

    // Fetch customers based on rules and logic
    const query = newAudience.rules.map(rule => ({
      [rule.field]: { [rule.operator]: rule.value }
    }));
    const customers = newAudience.logic === 'AND'
      ? await Customer.find({ $and: query })
      : await Customer.find({ $or: query });

    // Log communications
    const logs = customers.map(customer => ({
      audienceId: newAudience._id,
      customerId: customer._id
    }));
    await CommunicationLog.insertMany(logs);
    console.log('Communication logs created:', logs);

    // Trigger dummy vendor API
    logs.forEach(log => triggerVendorAPI(log));

    res.status(201).send(newAudience);
  } catch (error) {
    console.error('Failed to create audience', error);
    res.status(400).send('Failed to create audience');
  }
});


// API to create new campaign
app.post('/api/campaign', (req, res) => {
  const { name, criteria } = req.body;
  if (!name || !criteria) {
    return res.status(400).send('Invalid input');
  }
  channel.sendToQueue('campaignQueue', Buffer.from(JSON.stringify(req.body)));
  console.log('Sent to campaignQueue:', req.body);
  res.status(202).send('Campaign creation request received');
});


app.post('/api/audience/check-size', async (req, res) => {
  const { rules, logic } = req.body;
  try {
    const size = await calculateAudienceSize(rules, logic);
    res.status(200).send({ size });
  } catch (error) {
    res.status(500).send('Failed to calculate audience size');
  }
});

async function calculateAudienceSize(rules, logic) {
  try {
    const size = await Audience.countDocuments();
    return size;
  } catch (error) {
    console.error('Failed to calculate audience size:', error);
    throw error;
  }
}



app.get('/api/campaigns', async (req, res) => {
  try {
    const campaigns = await Campaign.find({}).sort({ createdAt: -1 });
    console.log('Fetched campaigns from database:', campaigns); // Add this log

    const campaignStats = await Promise.all(campaigns.map(async campaign => {
      const audienceSize = await CommunicationLog.countDocuments({ audienceId: campaign._id });
      const sentCount = await CommunicationLog.countDocuments({ audienceId: campaign._id, status: 'SENT' });
      const failedCount = await CommunicationLog.countDocuments({ audienceId: campaign._id, status: 'FAILED' });

      return {
        ...campaign._doc,
        audienceSize,
        sentCount,
        failedCount
      };
    }));
    console.log('Campaign statistics:', campaignStats); // Add this log

    res.json(campaignStats);
  } catch (error) {
    console.error('Failed to fetch campaigns', error);
    res.status(500).send('Failed to fetch campaigns');
  }
});

function authenticateToken(req, res, next) {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  jwt.verify(token, jwtSecret, (err, decoded) => {
    if (err) {
      console.error("Token verification failed:", err);
      return res.status(403).json({ error: "Forbidden" });
    }

    req.user = decoded;
    next();
  });
}




// Logout Route
app.post('/logout', authenticateToken, (req, res) => {
  try {
    res.clearCookie('token'); // Clear the token cookie
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});



// Middleware to verify the token on each request
const verifyToken = (req, res, next) => {
  const token = req.cookies.token;

  if (!token) {
    return res.status(403).json({
      code: 403,
      message: "Unauthorized",
    });
  }

  jwt.verify(token, jwtSecret, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        code: 401,
        message: "Invalid token",
      });
    }

    req.decoded = decoded;
    next();
  });
};
// app.listen(4000);
app.listen(process.env.PORT || 3000, () => {
  console.log("Server is running");
});
