const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require('jsonwebtoken')
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const app = express();
const port = process.env.PORT || 3001;

app.use(
  cors({
    origin: ["http://localhost:5174", "http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.b6ckjyi.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

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

    // Models
    const database = client.db("CashTaka");
    const UsersCollection = database.collection("users"); 

    app.post('/users', async (req, res)=>{
      const user = req.body
      const salt = await bcrypt.genSalt(10);
      const hashedPin = await bcrypt.hash(user.pin, salt);
      user.pin = hashedPin;
      const exists = await UsersCollection.findOne({'$or':[{email:user.email},{number: user.number}]})
      if(!exists){
        const response = await UsersCollection.insertOne(user) 
      if(response.acknowledged){
        res.send({success: true, message: "User created successfully"})
      } 
      else{
        res.send({success: false, message: "Database Error: Failed to create user"})
      }
      }
      else{
        res.send({success: false, message: "Email / Phone number already exists"})
      }
    })

    app.post('/login', async (req, res) => {
      const data = req.body
      existingUser = await UsersCollection.findOne({'$or':[{email:data.user},{number: data.user}]})
      if (!existingUser) {
        return res.status(404).json({ success: false, message: 'Invalid email or number' });
      }
      else{
        const validPin = await bcrypt.compare(data.pin, existingUser.pin);
        if(!validPin){
          return res.status(404).json({ success: false, message: 'Invalid pin' });
        }
        else{
          const token = jwt.sign(data, process.env.JWT_Secret, { expiresIn: '1h' });
          return res.status(200).send({token, user:existingUser});
        }
      }
    })


  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello CashTaka!");
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
